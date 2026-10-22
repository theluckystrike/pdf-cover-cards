import { BasesView, Keymap, Notice, TFile, setIcon, type App, type BasesAllOptions, type PaneType, type BasesEntry, type BasesPropertyId, type HoverParent, type HoverPopover, type QueryController } from 'obsidian';
import { barText, cardStatuses, chooseCover, chooseImage, imageAspect, pagesLabel, type CoverChoice, type Crop } from './cover';
import { coverImage, decodeImage } from './image';
import { FREE_MAX_COVERS, isPro, onProChange } from './pro';
import type PdfCoverCardsPlugin from './main';

export const VIEW_ID = 'pdf-cover-cards';
const DEFAULT_WIDTH = 180;
/** A4 portrait: the placeholder shape before a cover is drawn. */
const PLACEHOLDER_ASPECT = 1.414;
/** Set after the first warning that the vault gives no resource URL for images, so the console gets one line. */
let resourceWarned = false;

/** Subpath that opens a PDF at the page of a choice, for example `#page=3`. */
export function pdfSubpath(choice: CoverChoice): string {
	return `#page=${choice.page}`;
}

/** Opens the PDF of a choice at its page. Opens the file by path, so a `#` in the file name does not break the link. */
export async function openPdfAt(app: App, choice: CoverChoice, newLeaf: PaneType | boolean): Promise<void> {
	const pdf = app.vault.getFileByPath(choice.path);
	if (!pdf) return;
	await app.workspace.getLeaf(newLeaf).openFile(pdf, { eState: { subpath: pdfSubpath(choice) } });
}

/** Adds the "Open at page N" button. Its click and its Enter key stay on the button, so the card does not also open the note. */
export function openPdfButton(parent: HTMLElement, choice: CoverChoice, open: (choice: CoverChoice, newLeaf: PaneType | boolean) => void): HTMLButtonElement {
	const button = parent.createEl('button', { cls: 'pdf-cover-card-open-pdf', text: `Open at page ${choice.page}` });
	button.addEventListener('keydown', (evt) => {
		if (evt.key === 'Enter') evt.stopPropagation();
	});
	button.addEventListener('click', (evt) => {
		evt.stopPropagation();
		open(choice, Keymap.isModEvent(evt));
	});
	return button;
}

/** One card as drawn: its note, its cover choice and the element that holds the cover. */
export interface CardState {
	file: TFile;
	choice: CoverChoice | null;
	/** Vault path of the image cover, when the card has no PDF and "Show images when there is no PDF" is on. */
	image: string | null;
	coverEl: HTMLElement;
	/** The "Open at page N" button, when the card has a PDF. */
	openEl?: HTMLButtonElement;
	pageControls?: HTMLElement;
	/** True when this card is within the cover limit. */
	slot: boolean;
	/** drawn, empty (no PDF and no image), locked (free limit), error, or waiting. */
	status: 'waiting' | 'drawn' | 'empty' | 'locked' | 'error';
	aspect: number;
	pages: number;
}

/** Bases view that shows each entry as a card with the first page (or a chosen page) of its PDF as the cover. */
export class PdfCoverView extends BasesView implements HoverParent {
	type = VIEW_ID;
	hoverPopover: HoverPopover | null = null;
	/** The cards of the newest draw, in base order, for export and tests. */
	cards: CardState[] = [];
	private urls: string[] = [];
	private observer: IntersectionObserver | null = null;
	private token = 0;
	private timer: number | null = null;

	constructor(
		controller: QueryController,
		readonly containerEl: HTMLElement,
		private readonly plugin: PdfCoverCardsPlugin,
	) {
		super(controller);
		this.containerEl.addClass('pdf-cover-cards');
		// Bases hides an empty view container in embeds and then never loads it, so the view starts with a line of text.
		this.containerEl.createDiv({ cls: 'pdf-cover-cards-empty', text: 'Loading covers...' });
	}

	/**
	 * Events go here, not in the constructor: Bases can unload a view and load the same object again (for example
	 * when the plugin reloads with a base open), and an unload removes everything that was registered.
	 */
	onload(): void {
		this.plugin.views.add(this);
		this.register(onProChange(() => this.schedule()));
		this.registerEvent(
			this.app.vault.on('modify', (f) => {
				if (f instanceof TFile && this.cards.some((c) => c.choice?.path === f.path || c.image === f.path)) this.schedule();
			}),
		);
		if (this.cards.length > 0) this.schedule();
	}

	onunload(): void {
		this.plugin.views.delete(this);
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.token++;
		this.observer?.disconnect();
		this.revoke();
	}

	onDataUpdated(): void {
		this.schedule();
	}

	/** Draws again after a short wait; calls in between restart the wait. */
	schedule(delay = 50): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.draw();
		}, delay);
	}

	/** The options of this view from the base file, with Pro-only options reset for free users. */
	options(): { prop: BasesPropertyId | null; useLinks: boolean; showImages: boolean; width: number; showProps: boolean; crop: Crop } {
		const c = this.config;
		const width = Number(c.get('cardWidth') ?? DEFAULT_WIDTH);
		const crop = c.get('crop');
		return {
			prop: c.getAsPropertyId('pdfProperty'),
			useLinks: c.get('useLinks') !== false,
			showImages: c.get('showImages') !== false,
			width: Number.isFinite(width) ? Math.min(400, Math.max(120, width)) : DEFAULT_WIDTH,
			showProps: c.get('showProps') !== false,
			crop: isPro() && (crop === 'top-half' || crop === 'top-third') ? crop : 'page',
		};
	}

	private revoke(): void {
		for (const u of this.urls) URL.revokeObjectURL(u);
		this.urls = [];
	}

	/** Text values of the PDF property for one entry: raw front matter for note properties, else the value as text. */
	private propertyValues(entry: BasesEntry, prop: BasesPropertyId | null): string[] {
		if (!prop) return [];
		if (prop.startsWith('note.')) {
			const key = prop.slice('note.'.length);
			const cache = this.app.metadataCache.getFileCache(entry.file);
			const links = (cache?.frontmatterLinks ?? []).filter((l) => l.key === key || l.key.startsWith(`${key}.`)).map((l) => l.link);
			const raw: unknown = cache?.frontmatter?.[key];
			const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
			return [...links, ...values.filter((v): v is string => typeof v === 'string')];
		}
		const v = entry.getValue(prop);
		return v ? [v.toString()] : [];
	}

	/** Links and embeds of the note body in note order, as written (link path plus subpath). */
	private bodyLinks(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		const all = [...(cache?.embeds ?? []), ...(cache?.links ?? [])];
		all.sort((a, b) => a.position.start.offset - b.position.start.offset);
		return all.map((l) => l.link);
	}

	/** Builds the cards for the current data and starts drawing the covers that are on screen. */
	draw(): void {
		// A Pro change can arrive before Bases has given this view its first data.
		if (!(this.data as BasesView['data'] | undefined)) return;
		const run = ++this.token;
		const opts = this.options();
		const pro = isPro();
		const entries = this.data.data;
		this.observer?.disconnect();
		this.revoke();
		const el = this.containerEl;
		el.empty();
		const resolve = (fromPath: string) => (linkpath: string) => this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath)?.path ?? null;
		const inputs = entries.map((e) => ({ self: { path: e.file.path, ext: e.file.extension }, property: this.propertyValues(e, opts.prop), links: opts.useLinks ? this.bodyLinks(e.file) : [], useLinks: opts.useLinks }));
		const choices = inputs.map((input, i) => chooseCover(input, resolve(entries[i]!.file.path)));
		// A PDF always wins. An image is a cover only for a card without a PDF.
		const images = inputs.map((input, i) => (choices[i] === null && opts.showImages ? chooseImage(input, resolve(entries[i]!.file.path)) : null));
		const statuses = cardStatuses(choices.map((c, i) => (c ? 'pdf' : images[i] ? 'image' : null)), pro, FREE_MAX_COVERS);
		const withPdf = choices.filter((c) => c !== null).length;
		const locked = statuses.filter((x) => x === 'locked').length;
		this.drawBar(el, entries.length, withPdf, images.filter((x) => x !== null).length, locked);
		if (entries.length === 0) {
			el.createDiv({ cls: 'pdf-cover-cards-empty', text: 'No notes. The filters of this base select no files.' });
			this.cards = [];
			return;
		}
		const grid = el.createDiv({ cls: 'pdf-cover-cards-grid' });
		grid.style.setProperty('--pdf-cover-cards-width', `${opts.width}px`);
		const order = opts.showProps ? this.config.getOrder().filter((p) => p !== 'file.name' && p !== opts.prop) : [];
		this.cards = entries.map((entry, i) => this.card(grid, entry, choices[i] ?? null, images[i] ?? null, statuses[i] ?? 'empty', order));
		this.observer = new IntersectionObserver((seen) => this.onSeen(seen, run, opts), { root: null, rootMargin: '400px' });
		for (const c of this.cards) if (c.slot) this.observer.observe(c.coverEl);
	}

	private drawBar(el: HTMLElement, entries: number, withPdf: number, withImage: number, locked: number): void {
		const bar = el.createDiv({ cls: 'pdf-cover-cards-bar' });
		bar.createSpan({ text: barText(entries, withPdf, withImage) });
		if (locked > 0) {
			bar.createSpan({ cls: 'pdf-cover-cards-limit', text: `The free version draws the first ${FREE_MAX_COVERS} PDF covers. ${locked} more ${locked === 1 ? 'cover is' : 'covers are'} not drawn.` });
		}
		if (!isPro()) return;
		const b = bar.createEl('button', { cls: 'pdf-cover-cards-export', text: 'Export contact sheet' });
		b.addEventListener('click', () => void this.plugin.exportSheet(this));
	}

	private card(grid: HTMLElement, entry: BasesEntry, choice: CoverChoice | null, image: string | null, status: CardState['status'], order: BasesPropertyId[]): CardState {
		const file = entry.file;
		const card = grid.createDiv({ cls: 'pdf-cover-card', attr: { 'data-path': file.path, tabindex: '0' } });
		const coverEl = card.createDiv({ cls: 'pdf-cover-card-cover' });
		coverEl.style.setProperty('--pdf-cover-cards-aspect', String(PLACEHOLDER_ASPECT));
		const state: CardState = { file, choice, image, coverEl, slot: status === 'waiting', status, aspect: PLACEHOLDER_ASPECT, pages: 0 };
		if (state.status !== 'waiting') {
			coverEl.addClass('is-placeholder');
			setIcon(coverEl.createDiv({ cls: 'pdf-cover-card-icon' }), choice ? 'lock' : 'file-text');
			if (state.status === 'locked') coverEl.createDiv({ cls: 'pdf-cover-card-note', text: 'Pro draws this cover' });
		} else coverEl.addClass('is-loading');
		const body = card.createDiv({ cls: 'pdf-cover-card-body' });
		body.createDiv({ cls: 'pdf-cover-card-title', text: file.extension === 'md' ? file.basename : file.name });
		for (const p of order) {
			const v = entry.getValue(p);
			const text = v && v.isTruthy() ? v.toString() : '';
			if (!text) continue;
			const row = body.createDiv({ cls: 'pdf-cover-card-prop' });
			row.createSpan({ cls: 'pdf-cover-card-prop-name', text: this.config.getDisplayName(p) });
			row.createSpan({ cls: 'pdf-cover-card-prop-value', text });
		}
		const open = (evt: MouseEvent | KeyboardEvent) => void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
		card.addEventListener('click', open);
		card.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') open(evt);
		});
		if (choice) state.openEl = openPdfButton(body, choice, (c, newLeaf) => void openPdfAt(this.app, c, newLeaf));
		card.addEventListener('mouseover', (event) => {
			this.app.workspace.trigger('hover-link', { event, source: VIEW_ID, hoverParent: this, targetEl: card, linktext: file.path, sourcePath: '' });
		});
		return state;
	}

	private onSeen(seen: IntersectionObserverEntry[], run: number, opts: ReturnType<PdfCoverView['options']>): void {
		for (const s of seen) {
			if (!s.isIntersecting) continue;
			this.observer?.unobserve(s.target);
			const card = this.cards.find((c) => c.coverEl === s.target);
			if (card) void this.fill(card, run, opts);
		}
	}

	/** Draws (or loads) the cover of one card into its cover element. */
	async fill(card: CardState, run: number, opts: ReturnType<PdfCoverView['options']>): Promise<void> {
		if (run !== this.token || card.status !== 'waiting') return;
		if (!card.choice && card.image) return this.fillImage(card, card.image, run, opts);
		const pdf = card.choice ? this.app.vault.getFileByPath(card.choice.path) : null;
		if (!pdf || !card.choice) return;
		try {
			const cover = await this.plugin.renderer.cover({ file: pdf, page: card.choice.page, width: opts.width, crop: opts.crop, disk: isPro() && this.plugin.settings.saveCovers });
			// The observer and fillAll can await the same render. Only the first completion adds an image.
			if (run !== this.token || card.status !== 'waiting') return;
			const { image, url } = await coverImage(cover.blob);
			// Decode can finish after a redraw, unload, or a second fill of the same card.
			if (run !== this.token || card.status !== 'waiting') {
				URL.revokeObjectURL(url);
				return;
			}
			this.urls.push(url);
			card.coverEl.removeClass('is-loading');
			card.coverEl.style.setProperty('--pdf-cover-cards-aspect', String(cover.aspect));
			image.alt = `Page ${cover.page} of ${pdf.name}`;
			image.draggable = false;
			card.coverEl.appendChild(image);
			card.coverEl.createSpan({ cls: 'pdf-cover-card-pages', text: pagesLabel(cover.pages) });
			card.status = 'drawn';
			card.aspect = cover.aspect;
			card.pages = cover.pages;
			// The renderer clamps the page to the page count, so the button opens the page that the cover shows.
			if (cover.page !== card.choice.page) {
				card.choice.page = cover.page;
				card.openEl?.setText(`Open at page ${cover.page}`);
			}
			this.drawPageControls(card);
		} catch (e) {
			if (run !== this.token || card.status !== 'waiting') return;
			this.showError(card, 'This PDF could not be read');
			console.warn(`PDF Cover Cards: ${pdf.path}`, e);
		}
	}

	/** Shows the error placeholder on a card. Removes the loading indicator. */
	private showError(card: CardState, text: string): void {
		card.status = 'error';
		card.coverEl.removeClass('is-loading');
		card.coverEl.addClass('is-placeholder');
		setIcon(card.coverEl.createDiv({ cls: 'pdf-cover-card-icon' }), 'file-warning');
		card.coverEl.createDiv({ cls: 'pdf-cover-card-note', text });
	}

	/**
	 * Shows an image file as the cover through its vault resource URL. No pdf.js, canvas, cache or saved cover. The
	 * crop keeps the top of the image: the cover box gets the cropped aspect and the CSS shows the top of the image.
	 */
	private async fillImage(card: CardState, path: string, run: number, opts: ReturnType<PdfCoverView['options']>): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		const image = createEl('img');
		try {
			if (!file) throw new Error('The image file is missing');
			image.src = this.app.vault.getResourcePath(file);
		} catch (e) {
			this.showError(card, 'This image could not be read');
			if (!resourceWarned) console.warn(`PDF Cover Cards: no resource URL for ${path}`, e);
			resourceWarned = true;
			return;
		}
		try {
			await decodeImage(image);
			const aspect = imageAspect(image.naturalWidth, image.naturalHeight, opts.crop);
			// Decode can finish after a redraw, unload, or a second fill of the same card.
			if (run !== this.token || card.status !== 'waiting') return;
			image.alt = file.name;
			image.draggable = false;
			card.coverEl.removeClass('is-loading');
			card.coverEl.style.setProperty('--pdf-cover-cards-aspect', String(aspect));
			card.coverEl.appendChild(image);
			card.status = 'drawn';
			card.aspect = aspect;
		} catch (e) {
			if (run !== this.token || card.status !== 'waiting') return;
			this.showError(card, 'This image could not be read');
			console.warn(`PDF Cover Cards: ${path}`, e);
		}
	}

	/** Browse a drawn card without changing its source note or PDF. */
	private drawPageControls(card: CardState): void {
		card.pageControls?.remove();
		if (card.pages < 2 || !card.openEl?.parentElement || !card.choice) return;
		const controls = card.openEl.parentElement.createDiv({ cls: 'pdf-cover-card-navigation' });
		card.pageControls = controls;
		for (const [step, label] of [[-1, 'Previous page'], [1, 'Next page']] as const) {
			const button = controls.createEl('button', { text: label, attr: { type: 'button' } });
			button.disabled = step < 0 ? card.choice.page <= 1 : card.choice.page >= card.pages;
			button.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.stopPropagation(); });
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				void this.changePage(card, step);
			});
		}
	}

	async changePage(card: CardState, step: number): Promise<void> {
		if (!this.cards.includes(card) || !card.slot || card.status !== 'drawn' || !card.choice) return;
		const page = card.choice.page + step;
		if (!Number.isInteger(page) || page < 1 || page > card.pages || page === card.choice.page) return;
		const image = card.coverEl.querySelector('img');
		if (image) {
			URL.revokeObjectURL(image.src);
			this.urls = this.urls.filter(url => url !== image.src);
		}
		card.coverEl.empty();
		card.coverEl.addClass('is-loading');
		card.choice.page = page;
		card.openEl?.setText(`Open at page ${page}`);
		card.status = 'waiting';
		card.pageControls?.querySelectorAll('button').forEach(button => { button.disabled = true; });
		await this.fill(card, this.token, this.options());
	}

	/** Draws every cover within the limit, also those off screen (contact sheet export). */
	async fillAll(): Promise<void> {
		const run = this.token;
		const opts = this.options();
		await Promise.all(this.cards.filter((c) => c.slot && c.status === 'waiting').map((c) => this.fill(c, run, opts)));
	}

	/** Is this view in the active tab? */
	isActive(): boolean {
		const leafEl = this.app.workspace.getMostRecentLeaf()?.view.containerEl ?? null;
		return leafEl !== null && this.containerEl.isConnected && leafEl.contains(this.containerEl);
	}

	/** The name of this view in the base. */
	get name(): string {
		return this.config.name || 'PDF covers';
	}

	/** Shows a notice that a feature needs Pro. */
	static needsPro(feature: string): void {
		new Notice(`${feature} is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
	}
}

/** The options shown in the view options menu of the base. */
export function viewOptions(): BasesAllOptions[] {
	return [
		{ type: 'property', key: 'pdfProperty', displayName: 'PDF property', placeholder: 'Property that links to a PDF' },
		{ type: 'toggle', key: 'useLinks', displayName: 'Use the first PDF link in the note', default: true },
		{ type: 'toggle', key: 'showImages', displayName: 'Show images when there is no PDF', default: true },
		{ type: 'slider', key: 'cardWidth', displayName: 'Card width', default: DEFAULT_WIDTH, min: 120, max: 400, step: 10 },
		{ type: 'toggle', key: 'showProps', displayName: 'Show properties', default: true },
		{
			type: 'group',
			displayName: 'Pro',
			items: [{ type: 'dropdown', key: 'crop', displayName: 'Cover crop', default: 'page', options: { page: 'Whole page', 'top-half': 'Top half', 'top-third': 'Top third' } }],
		},
	];
}
