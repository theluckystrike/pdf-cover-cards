import { Notice, Plugin, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { sheetLayout, sheetParts } from './cover';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { CoverRenderer } from './render';
import { DEFAULT_SETTINGS, PdfCoverCardsSettingTab, normalizeSettings, type PdfCoverCardsSettings } from './settings';
import { PdfCoverView, VIEW_ID, viewOptions } from './view';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/**
 * Contact sheet: cell width, gap and title line in pixels, covers per row, and the largest sheet height. A taller
 * view goes on more sheets: 12,000 x 1,344 pixels stays within the canvas area limit of iOS (4096 x 4096).
 */
const SHEET = { cell: 240, gap: 24, title: 36, columns: 5, maxHeight: 12000 };

export default class PdfCoverCardsPlugin extends Plugin {
	settings: PdfCoverCardsSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	renderer!: CoverRenderer;
	private settingTab: PdfCoverCardsSettingTab | null = null;
	/** Open cover views. A view adds itself when created and removes itself on unload. */
	readonly views = new Set<PdfCoverView>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.renderer = new CoverRenderer(this.app, this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`), () => this.settings);
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new PdfCoverCardsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerHoverLinkSource(VIEW_ID, { display: 'PDF Cover Cards', defaultMod: true });
		const ok = this.registerBasesView(VIEW_ID, {
			name: 'PDF covers',
			icon: 'book-image',
			factory: (controller, containerEl) => new PdfCoverView(controller, containerEl, this),
			options: viewOptions,
		});
		if (!ok) console.warn('PDF Cover Cards: Bases is turned off in this vault, so the view is not available.');
		this.addCommand({
			id: 'export-contact-sheet',
			name: 'Export the covers of this view as a contact sheet',
			checkCallback: (checking) => {
				const view = this.targetView();
				if (!view) return false;
				if (!checking) void this.exportSheet(view);
				return true;
			},
		});
		this.addCommand({
			id: 'clear-saved-covers',
			name: 'Clear saved covers',
			callback: async () => {
				const n = await this.renderer.clear();
				new Notice(`Deleted ${n} saved cover ${n === 1 ? 'file' : 'files'}.`);
				this.redrawAll();
			},
		});
		this.app.workspace.onLayoutReady(() => {
			void this.reopenStaleBases();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
		this.renderer?.memory.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<PdfCoverCardsSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Draws every open cover view again. */
	redrawAll(): void {
		for (const v of this.views) v.schedule(0);
	}

	/**
	 * After a plugin update or reload, Bases keeps showing the cover views of the old plugin code: they miss Pro and
	 * the commands. This opens each such base tab again, so its view runs the current code. A first start finds none.
	 */
	async reopenStaleBases(): Promise<number> {
		let n = 0;
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const el = leaf.view.containerEl;
			const stale = el.querySelector('.pdf-cover-cards') !== null && ![...this.views].some((v) => el.contains(v.containerEl));
			if (!stale) continue;
			const state = leaf.getViewState();
			await leaf.setViewState({ type: 'empty' });
			await leaf.setViewState(state);
			n++;
		}
		return n;
	}

	/** The cover view in the active tab, or else the one drawn last. */
	targetView(): PdfCoverView | null {
		const open = [...this.views].filter((v) => v.cards.length > 0);
		return open.find((v) => v.isActive()) ?? open[open.length - 1] ?? null;
	}

	/**
	 * Pro: draws the drawn covers of the view on a PNG image with the card titles, saves it in the vault and opens it.
	 * A large view goes on more than one image. Gives the first image.
	 */
	async exportSheet(view: PdfCoverView): Promise<TFile | null> {
		if (!isPro()) {
			PdfCoverView.needsPro('The contact sheet export');
			return null;
		}
		await view.fillAll();
		const cards = view.cards.filter((c) => c.status === 'drawn');
		if (cards.length === 0) {
			new Notice('No covers to export in this view.');
			return null;
		}
		const now = new Date();
		const pad = (n: number): string => String(n).padStart(2, '0');
		const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
		const title = `${view.name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()} covers ${stamp}`.trim();
		const folder = this.app.fileManager.getNewFileParent('');
		const aspects = cards.map((c) => c.aspect);
		const parts = sheetParts(aspects, SHEET.columns, SHEET.cell, SHEET.gap, SHEET.title, SHEET.maxHeight);
		const files: TFile[] = [];
		for (let k = 0; k < parts.length; k++) {
			const [start, end] = parts[k]!;
			const blob = await drawSheet(cards.slice(start, end), aspects.slice(start, end));
			if (!blob) {
				new Notice('The contact sheet could not be drawn.');
				break;
			}
			const name = parts.length > 1 ? `${title} part ${k + 1} of ${parts.length}` : title;
			const base = normalizePath(`${folder.path === '/' ? '' : folder.path + '/'}${name}`);
			let path = `${base}.png`;
			for (let n = 2; this.app.vault.getAbstractFileByPath(path) && n < 1000; n++) path = `${base} ${n}.png`;
			files.push(await this.app.vault.createBinary(path, await blob.arrayBuffer()));
		}
		const file = files[0];
		if (!file) return null;
		new Notice(files.length > 1 ? `Exported ${cards.length} covers to ${files.length} contact sheets in ${folder.path}` : `Exported ${cards.length} covers to ${file.path}`);
		await this.app.workspace.getLeaf('tab').openFile(file);
		return file;
	}
}

/** Draws the covers of `cards` on one PNG contact sheet with their titles. Null when the canvas gives no image. */
async function drawSheet(cards: PdfCoverView['cards'], aspects: number[]): Promise<Blob | null> {
	const layout = sheetLayout(aspects, SHEET.columns, SHEET.cell, SHEET.gap, SHEET.title);
	const canvas = createEl('canvas');
	canvas.width = layout.width;
	canvas.height = layout.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, layout.width, layout.height);
	ctx.font = '600 15px sans-serif';
	ctx.textBaseline = 'alphabetic';
	for (let i = 0; i < cards.length; i++) {
		const card = cards[i]!;
		const cell = layout.cells[i]!;
		const img = card.coverEl.querySelector('img');
		if (!img) continue;
		try {
			await img.decode();
		} catch {
			// The view drew again during the export and its old image is gone. Leave this cell empty.
			continue;
		}
		ctx.drawImage(img, cell.x, cell.y, SHEET.cell, cell.coverHeight);
		ctx.strokeStyle = '#d0d0d0';
		ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, SHEET.cell - 1, cell.coverHeight - 1);
		ctx.fillStyle = '#222222';
		ctx.fillText(fitText(ctx, card.file.extension === 'md' ? card.file.basename : card.file.name, SHEET.cell), cell.x, cell.titleY);
	}
	return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
}

/** Cuts text with an ellipsis so it fits `width` pixels in the current canvas font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
	if (ctx.measureText(text).width <= width) return text;
	let s = text;
	while (s.length > 1 && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
	return `${s.trimEnd()}…`;
}
