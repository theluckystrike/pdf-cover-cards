import { BasesView, Keymap, Notice, TFile, setIcon, type BasesAllOptions, type BasesEntry, type BasesPropertyId, type HoverParent, type HoverPopover, type QueryController } from 'obsidian';
import { chooseCover, coverSlots, pagesLabel, type CoverChoice, type Crop } from './cover';
import { FREE_MAX_COVERS, isPro, onProChange } from './pro';
import type PdfCoverCardsPlugin from './main';

export const VIEW_ID = 'pdf-cover-cards';
const DEFAULT_WIDTH = 180;
/** A4 portrait: the placeholder shape before a cover is drawn. */
const PLACEHOLDER_ASPECT = 1.414;

/** One card as drawn: its note, its cover choice and the element that holds the cover. */
export interface CardState {
	file: TFile;
	choice: CoverChoice | null;
	coverEl: HTMLElement;
	/** True when this card is within the cover limit. */
	slot: boolean;
	/** drawn, empty (no PDF), locked (free limit), error, or waiting. */
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
		private readonly containerEl: HTMLElement,
		private readonly plugin: PdfCoverCardsPlugin,
	) {
		super(controller);
		this.containerEl.addClass('pdf-cover-cards');
		// Bases hides an empty view container in embeds and then never loads it, so the view starts with a line of text.
		this.containerEl.createDiv({ cls: 'pdf-cover-cards-empty', text: 'Loading covers...' });
		this.plugin.views.add(this);
		this.register(onProChange(() => this.schedule()));
		this.registerEvent(
			this.app.vault.on('modify', (f) => {
				if (f instanceof TFile && this.cards.some((c) => c.choice?.path === f.path)) this.schedule();
			}),
		);
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
	options(): { prop: BasesPropertyId | null; useLinks: boolean; width: number; showProps: boolean; crop: Crop } {
		const c = this.config;
		const width = Number(c.get('cardWidth') ?? DEFAULT_WIDTH);
		const crop = c.get('crop');
		return {
			prop: c.getAsPropertyId('pdfProperty'),
			useLinks: c.get('useLinks') !== false,
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
		const choices = entries.map((e) =>
			chooseCover({ self: { path: e.file.path, ext: e.file.extension }, property: this.propertyValues(e, opts.prop), links: opts.useLinks ? this.bodyLinks(e.file) : [], useLinks: opts.useLinks }, resolve(e.file.path)),
		);
		const withPdf = choices.filter((c) => c !== null).length;
		const slots = coverSlots(withPdf, pro, FREE_MAX_COVERS);
		this.drawBar(el, entries.length, withPdf, slots);
		if (entries.length === 0) {
			el.createDiv({ cls: 'pdf-cover-cards-empty', text: 'No notes. The filters of this base select no files.' });
			this.cards = [];
			return;
		}
		const grid = el.createDiv({ cls: 'pdf-cover-cards-grid' });
		grid.style.setProperty('--pdf-cover-cards-width', `${opts.width}px`);
		const order = opts.showProps ? this.config.getOrder().filter((p) => p !== 'file.name' && p !== opts.prop) : [];
		let used = 0;
		this.cards = entries.map((entry, i) => {
			const choice = choices[i] ?? null;
			const slot = choice !== null && used++ < slots;
			return this.card(grid, entry, choice, slot, order);
		});
		this.observer = new IntersectionObserver((seen) => this.onSeen(seen, run, opts), { root: null, rootMargin: '400px' });
		for (const c of this.cards) if (c.slot) this.observer.observe(c.coverEl);
	}

	private drawBar(el: HTMLElement, entries: number, withPdf: number, slots: number): void {
		const bar = el.createDiv({ cls: 'pdf-cover-cards-bar' });
		bar.createSpan({ text: `${entries} ${entries === 1 ? 'card' : 'cards'}, ${withPdf} with a PDF` });
		if (slots < withPdf) {
			bar.createSpan({ cls: 'pdf-cover-cards-limit', text: `The free version draws the first ${FREE_MAX_COVERS} covers. ${withPdf - slots} more ${withPdf - slots === 1 ? 'cover is' : 'covers are'} not drawn.` });
		}
		if (!isPro()) return;
		const b = bar.createEl('button', { cls: 'pdf-cover-cards-export', text: 'Export contact sheet' });
		b.addEventListener('click', () => void this.plugin.exportSheet(this));
	}

	private card(grid: HTMLElement, entry: BasesEntry, choice: CoverChoice | null, slot: boolean, order: BasesPropertyId[]): CardState {
		const file = entry.file;
		const card = grid.createDiv({ cls: 'pdf-cover-card', attr: { 'data-path': file.path, tabindex: '0' } });
		const coverEl = card.createDiv({ cls: 'pdf-cover-card-cover' });
		coverEl.style.setProperty('--pdf-cover-cards-aspect', String(PLACEHOLDER_ASPECT));
		const state: CardState = { file, choice, coverEl, slot, status: choice ? (slot ? 'waiting' : 'locked') : 'empty', aspect: PLACEHOLDER_ASPECT, pages: 0 };
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
		const pdf = card.choice ? this.app.vault.getFileByPath(card.choice.path) : null;
		if (!pdf || !card.choice) return;
		try {
			const cover = await this.plugin.renderer.cover({ file: pdf, page: card.choice.page, width: opts.width, crop: opts.crop, disk: isPro() && this.plugin.settings.saveCovers });
			if (run !== this.token) return;
			const url = URL.createObjectURL(cover.blob);
			this.urls.push(url);
			card.coverEl.removeClass('is-loading');
			card.coverEl.style.setProperty('--pdf-cover-cards-aspect', String(cover.aspect));
			card.coverEl.createEl('img', { attr: { src: url, alt: `Page ${cover.page} of ${pdf.name}`, draggable: 'false' } });
			card.coverEl.createSpan({ cls: 'pdf-cover-card-pages', text: pagesLabel(cover.pages) });
			card.status = 'drawn';
			card.aspect = cover.aspect;
			card.pages = cover.pages;
		} catch (e) {
			if (run !== this.token) return;
			card.status = 'error';
			card.coverEl.removeClass('is-loading');
			card.coverEl.addClass('is-placeholder');
			setIcon(card.coverEl.createDiv({ cls: 'pdf-cover-card-icon' }), 'file-warning');
			card.coverEl.createDiv({ cls: 'pdf-cover-card-note', text: 'This PDF could not be read' });
			console.warn(`PDF Cover Cards: ${pdf.path}`, e);
		}
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
		{ type: 'slider', key: 'cardWidth', displayName: 'Card width', default: DEFAULT_WIDTH, min: 120, max: 400, step: 10 },
		{ type: 'toggle', key: 'showProps', displayName: 'Show properties', default: true },
		{
			type: 'group',
			displayName: 'Pro',
			items: [{ type: 'dropdown', key: 'crop', displayName: 'Cover crop', default: 'page', options: { page: 'Whole page', 'top-half': 'Top half', 'top-third': 'Top third' } }],
		},
	];
}
