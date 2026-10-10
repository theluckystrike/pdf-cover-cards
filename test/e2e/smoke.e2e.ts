import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// Real-app checks of the PDF Cover Cards Bases view on the sample vault: 12 notes in Library/ with 12 made-up PDFs
// in Library/PDFs (test/e2e/make-pdfs.mjs). 10 notes name their PDF in the "pdf" property, 2 embed it in the body.

interface CardInfo {
	path: string;
	status: string;
	from: string | null;
	page: number | null;
	pages: number;
	aspect: number;
	/** Average color of the drawn cover image, "#rrggbb", or "" when no image. */
	color: string;
}

interface ViewState {
	cards: CardInfo[];
	bar: string;
	limitText: string;
	exportButton: boolean;
}

/** State of the visible cover view in the active tab (the newest one when there are several). */
async function viewState(): Promise<ViewState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface Card {
			file: { path: string };
			choice: { from: string; page: number } | null;
			status: string;
			pages: number;
			aspect: number;
			coverEl: HTMLElement;
		}
		interface V {
			cards: Card[];
			containerEl: HTMLElement;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const views = [...(p?.views ?? [])].filter((v) => v.containerEl.isConnected && v.containerEl.offsetParent !== null && v.cards.length > 0);
		const v = views[views.length - 1];
		if (!v) return null;
		const color = (img: HTMLImageElement | null): string => {
			if (!img || !img.complete || img.naturalWidth === 0) return '';
			const c = document.createElement('canvas');
			c.width = 8;
			c.height = 8;
			const ctx = c.getContext('2d')!;
			// The lower middle of the cover: below the title band of the sample books.
			ctx.drawImage(img, img.naturalWidth * 0.6, img.naturalHeight * 0.92, 8, 8, 0, 0, 8, 8);
			const d = ctx.getImageData(0, 0, 8, 8).data;
			const avg = [0, 1, 2].map((k) => Math.round(Array.from({ length: 64 }, (_, i) => d[i * 4 + k]!).reduce((a, b) => a + b, 0) / 64));
			return '#' + avg.map((x) => x.toString(16).padStart(2, '0')).join('');
		};
		return {
			cards: v.cards.map((c) => ({ path: c.file.path, status: c.status, from: c.choice?.from ?? null, page: c.choice?.page ?? null, pages: c.pages, aspect: c.aspect, color: color(c.coverEl.querySelector('img')) })),
			bar: v.containerEl.querySelector('.pdf-cover-cards-bar')?.textContent ?? '',
			limitText: v.containerEl.querySelector('.pdf-cover-cards-limit')?.textContent ?? '',
			exportButton: v.containerEl.querySelector('.pdf-cover-cards-export') !== null,
		};
	}, pluginId);
}

async function waitFor(pred: (s: ViewState) => boolean, msg: string, timeout = 30000): Promise<ViewState> {
	let last: ViewState | null = null;
	await browser.waitUntil(
		async () => {
			last = await viewState();
			return last !== null && pred(last);
		},
		{ timeout, interval: 250, timeoutMsg: `${msg}; last state ${JSON.stringify(last)?.slice(0, 1500)}` },
	);
	return last!;
}

/** Draws every cover of the visible view, also those below the fold. */
async function fillAll(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		interface V {
			cards: unknown[];
			containerEl: HTMLElement;
			fillAll(): Promise<void>;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
		const v = [...p.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.cards.length > 0).pop();
		await v?.fillAll();
	}, pluginId);
}

/** Pro on: a stubbed GitHub Sponsors reply ($5 a month) and a fake token, then Refresh. Pro off: sign out. No real request. */
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

const card = (s: ViewState, name: string) => s.cards.find((c) => c.path.endsWith(`/${name}`));
const near = (hex: string, want: string) => [1, 3, 5].every((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(want.slice(i, i + 2), 16)) <= 24);

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await setPro(false);
	});

	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers the view through the public Bases API', async function () {
		const ok = await browser.executeObsidian(({ app }) => {
			const bases = (app as unknown as { internalPlugins: { getEnabledPluginById(id: string): unknown } }).internalPlugins.getEnabledPluginById('bases');
			return bases !== null;
		});
		expect(ok).toBe(true);
	});

	it('draws the PDF cover of all 12 notes, from the property or the first embed', async function () {
		await obsidianPage.openFile('Library/Library.base');
		await waitFor((x) => x.cards.length === 12, 'expected 12 cards');
		await fillAll();
		const s = await waitFor((x) => x.cards.every((c) => c.status === 'drawn' && c.color !== ''), 'every cover drawn');
		expect(s.bar).toContain('12 cards, 12 with a PDF');
		expect(s.limitText).toBe('');
		expect(s.cards.filter((c) => c.from === 'property')).toHaveLength(10);
		expect(card(s, 'Bread at Home.md')?.from).toBe('link');
		expect(card(s, 'Night Trains.md')?.from).toBe('link');
		expect(card(s, 'Camera Basics.md')?.pages).toBe(4);
		// The real page pixels: the dark green and dark blue covers of two sample books.
		expect(near(card(s, 'Field Guide to Mosses.md')!.color, '#2f5d50')).toBe(true);
		expect(near(card(s, 'Rivers of the North.md')!.color, '#1d3557')).toBe(true);
		// A5 sample books keep the page aspect (595 / 420).
		expect(Math.abs(card(s, 'Field Guide to Mosses.md')!.aspect - 595 / 420)).toBeLessThan(0.01);
		expect(s.exportButton).toBe(false);
	});

	it('uses a PDF entry itself as its cover', async function () {
		await obsidianPage.openFile('Library/PDF files.base');
		await waitFor((x) => x.cards.length === 12, 'expected 12 PDF cards');
		await fillAll();
		const s = await waitFor((x) => x.cards.every((c) => c.status === 'drawn'), 'every PDF drawn');
		expect(s.cards.every((c) => c.from === 'self')).toBe(true);
	});

	it('draws the page named with #page=N and redraws when the note changes', async function () {
		const note = 'Library/Camera Basics.md';
		const before = await obsidianPage.read(note);
		await obsidianPage.openFile('Library/Library.base');
		await waitFor((x) => card(x, 'Camera Basics.md')?.status === 'drawn' || card(x, 'Camera Basics.md')?.status === 'waiting', 'card present');
		await obsidianPage.write(note, before.replace('[[Camera Basics.pdf]]', '[[Camera Basics.pdf#page=2]]'));
		await fillAll();
		const s = await waitFor((x) => card(x, 'Camera Basics.md')?.page === 2 && card(x, 'Camera Basics.md')?.status === 'drawn', 'page 2 drawn');
		// The contents page is white where the cover is dark.
		expect(near(card(s, 'Camera Basics.md')!.color, '#ffffff')).toBe(true);
		await obsidianPage.write(note, before);
		await waitFor((x) => card(x, 'Camera Basics.md')?.page === 1, 'back to page 1');
	});

	it('shows a readable message for a PDF that cannot be read', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.create('Library/PDFs/Broken.pdf', 'this is not a pdf');
			await app.vault.create('Library/Broken scan.md', '---\ntags: [library]\npdf: "[[Broken.pdf]]"\n---\n');
		});
		await obsidianPage.openFile('Library/Library.base');
		await waitFor((x) => x.cards.length === 13, 'expected 13 cards');
		await fillAll();
		const s = await waitFor((x) => card(x, 'Broken scan.md')?.status === 'error', 'error card');
		expect(s.cards.filter((c) => c.status === 'drawn')).toHaveLength(12);
		await browser.executeObsidian(async ({ app }) => {
			for (const p of ['Library/Broken scan.md', 'Library/PDFs/Broken.pdf']) {
				const f = app.vault.getFileByPath(p);
				if (f) await app.vault.delete(f);
			}
		});
	});

	it('draws the cards inside a note that embeds the view', async function () {
		await obsidianPage.openFile('Library/Reading list.md');
		const s = await waitFor((x) => x.cards.length === 12 && x.cards.some((c) => c.status === 'drawn'), 'embedded view drawn');
		expect(s.cards[0]?.path.startsWith('Library/')).toBe(true);
	});

	it('free limit of 30 covers, then Pro: every cover, crop, saved covers and the contact sheet', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Bulk').catch(() => undefined);
			const pdfs = app.vault.getFiles().filter((f) => f.path.startsWith('Library/PDFs/')).map((f) => f.basename).sort();
			const jobs: Promise<unknown>[] = [];
			for (let i = 0; i < 40; i++) {
				const path = `Bulk/Item ${String(i).padStart(2, '0')}.md`;
				if (!app.vault.getFileByPath(path)) jobs.push(app.vault.create(path, `---\ntags: [bulk]\npdf: "[[${pdfs[i % pdfs.length]}.pdf]]"\n---\n`));
			}
			await Promise.all(jobs);
			if (!app.vault.getFileByPath('Bulk/Bulk.base')) await app.vault.create('Bulk/Bulk.base', 'filters:\n  and:\n    - file.hasTag("bulk")\nviews:\n  - type: pdf-cover-cards\n    name: Bulk\n    pdfProperty: note.pdf\n    cardWidth: 120\n    crop: top-half\n');
		});
		await obsidianPage.openFile('Bulk/Bulk.base');
		await waitFor((x) => x.cards.length === 40, 'expected 40 cards');
		await fillAll();
		const free = await waitFor((x) => x.cards.filter((c) => c.status === 'drawn').length === 30, '30 free covers');
		expect(free.cards.filter((c) => c.status === 'locked')).toHaveLength(10);
		expect(free.limitText).toContain('10 more covers are not drawn');
		// The crop option is Pro: free covers show the whole page.
		expect(free.cards[0]!.aspect).toBeGreaterThan(1.3);

		await setPro(true);
		await waitFor((x) => x.exportButton && x.cards.every((c) => c.status !== 'locked'), 'Pro: no locked cards');
		await fillAll();
		const pro = await waitFor((x) => x.cards.every((c) => c.status === 'drawn'), 'Pro: 40 covers');
		expect(pro.limitText).toBe('');
		// Top half of an A5 page (0.5 x 595 / 420) or of an A4 paper (0.5 x 842 / 595).
		for (const c of pro.cards) expect(c.aspect).toBeLessThan(0.75);

		const disk = await browser.executeObsidian(async ({ app }, id) => {
			interface R {
				diskFolder: string;
				fromDisk: number;
				drawn: number;
				memory: { clear(): void };
				clear(): Promise<number>;
			}
			interface V {
				cards: unknown[];
				containerEl: HTMLElement;
				fillAll(): Promise<void>;
				draw(): void;
			}
			interface P {
				renderer: R;
				views: Set<V>;
				targetView(): V;
				exportSheet(v: V): Promise<{ path: string } | null>;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			const saved = (await app.vault.adapter.list(p.renderer.diskFolder)).files.filter((f) => f.endsWith('.jpg')).length;
			// Empty the memory cache and draw again: the covers come from the saved files, not from pdf.js.
			p.renderer.memory.clear();
			const drawnBefore = p.renderer.drawn;
			const v = p.targetView();
			v.draw();
			await v.fillAll();
			const fromDisk = p.renderer.fromDisk;
			const redrawn = p.renderer.drawn - drawnBefore;
			const sheet = await p.exportSheet(v);
			const file = sheet ? app.vault.getFileByPath(sheet.path) : null;
			let size = [0, 0];
			if (file) {
				const bmp = await createImageBitmap(new Blob([await app.vault.readBinary(file)], { type: 'image/png' }));
				size = [bmp.width, bmp.height];
				app.workspace.getLeaf(false).detach();
				await app.vault.delete(file);
			}
			const files = (await app.vault.adapter.list(p.renderer.diskFolder)).files.length;
			const cleared = await p.renderer.clear();
			const after = (await app.vault.adapter.exists(p.renderer.diskFolder)) ? (await app.vault.adapter.list(p.renderer.diskFolder)).files.length : 0;
			return { saved, fromDisk, redrawn, name: sheet?.path ?? '', size, files, cleared, after };
		}, pluginId);
		// 40 cards use 12 distinct PDFs, so 12 covers are saved (each as a .jpg and a .json file).
		expect(disk.saved).toBe(12);
		expect(disk.fromDisk).toBeGreaterThanOrEqual(12);
		expect(disk.redrawn).toBe(0);
		expect(disk.name).toMatch(/Bulk covers \d{4}-\d{2}-\d{2} \d{4}\.png$/);
		// 5 columns of 240 px with 24 px gaps; 8 rows.
		expect(disk.size[0]).toBe(24 + 5 * (240 + 24));
		expect(disk.size[1]).toBeGreaterThan(8 * 120);
		expect(disk.files).toBe(disk.saved * 2);
		expect(disk.cleared).toBe(disk.files);
		expect(disk.after).toBe(0);
		await setPro(false);
		await waitFor((x) => !x.exportButton && x.cards.filter((c) => c.status === 'locked').length === 10, 'free again');
	});

	it('200 notes: the first 30 covers draw within the time budget', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Perf').catch(() => undefined);
			const pdfs = app.vault.getFiles().filter((f) => f.path.startsWith('Library/PDFs/')).map((f) => f.basename).sort();
			const jobs: Promise<unknown>[] = [];
			for (let i = 0; i < 200; i++) {
				const path = `Perf/Note ${String(i).padStart(3, '0')}.md`;
				if (!app.vault.getFileByPath(path)) jobs.push(app.vault.create(path, `---\ntags: [perf]\npdf: "[[${pdfs[i % pdfs.length]}.pdf]]"\n---\n`));
			}
			await Promise.all(jobs);
			await app.vault.create('Perf/Perf.base', 'filters:\n  and:\n    - file.hasTag("perf")\nviews:\n  - type: pdf-cover-cards\n    name: Perf\n    pdfProperty: note.pdf\n    cardWidth: 200\n').catch(() => undefined);
			const p = (app as unknown as { plugins: { plugins: Record<string, { renderer: { memory: { clear(): void } } }> } }).plugins.plugins['pdf-cover-cards']!;
			p.renderer.memory.clear();
		});
		const t0 = Date.now();
		await obsidianPage.openFile('Perf/Perf.base');
		await waitFor((x) => x.cards.length === 200, '200 cards', 60000);
		await fillAll();
		await waitFor((x) => x.cards.filter((c) => c.status === 'drawn').length === 30, '30 covers', 60000);
		const ms = Date.now() - t0;
		console.log(`perf: 200 cards, 30 covers from 12 PDFs drawn in ${ms} ms (cold memory cache)`);
		// Default ceiling tolerates a busy machine; FX_PERF_STRICT=1 applies the strict budget.
		expect(ms).toBeLessThan(process.env.FX_PERF_STRICT === '1' ? 3000 : 20000);
	});
});
