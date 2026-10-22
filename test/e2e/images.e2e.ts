import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Real-app checks of image covers on cards without a PDF. The vault folder Scans/ has 6 notes with the tag "scan":
// 3 link a PDF of Library/PDFs in the "scan" property, Pottery Notebook links a JPG in the property, Harbor
// Postcards embeds a PNG in the body, and Letter from Aunt Ida has no file.

interface CardInfo {
	path: string;
	status: string;
	pdf: string | null;
	image: string | null;
	aspect: number;
	/** Height of the cover box in CSS pixels. */
	height: number;
	src: string;
	loading: boolean;
	text: string;
	button: boolean;
	pagesLabel: boolean;
}

interface ViewState {
	cards: CardInfo[];
	bar: string;
	limitText: string;
}

async function viewState(): Promise<ViewState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface Card {
			file: { path: string };
			choice: { path: string } | null;
			image: string | null;
			status: string;
			aspect: number;
			coverEl: HTMLElement;
		}
		interface V {
			cards: Card[];
			containerEl: HTMLElement;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const v = [...(p?.views ?? [])].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.cards.length > 0).pop();
		if (!v) return null;
		return {
			cards: v.cards.map((c) => ({
				path: c.file.path,
				status: c.status,
				pdf: c.choice?.path ?? null,
				image: c.image,
				aspect: c.aspect,
				height: c.coverEl.getBoundingClientRect().height,
				src: c.coverEl.querySelector('img')?.getAttribute('src') ?? '',
				loading: c.coverEl.classList.contains('is-loading'),
				text: c.coverEl.textContent ?? '',
				button: c.coverEl.parentElement?.querySelector('.pdf-cover-card-open-pdf') !== null,
				pagesLabel: c.coverEl.querySelector('.pdf-cover-card-pages') !== null,
			})),
			bar: v.containerEl.querySelector('.pdf-cover-cards-bar > span')?.textContent ?? '',
			limitText: v.containerEl.querySelector('.pdf-cover-cards-limit')?.textContent ?? '',
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
		{ timeout, interval: 200, timeoutMsg: `${msg}; last state ${JSON.stringify(last)?.slice(0, 1500)}` },
	);
	return last!;
}

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

/** Pro on: a stubbed GitHub Sponsors reply and a fake token. Pro off: sign out. No real request. */
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
const BASE = 'Scans/Scans.base';

describe(`${pluginId} image covers in the real app`, function () {
	let baseText = '';

	before(async function () {
		await setPro(false);
		baseText = await obsidianPage.read(BASE);
	});

	afterEach(async function () {
		await obsidianPage.write(BASE, baseText);
	});

	it('criterion 6 and 12: draws 3 PDF covers, 2 image covers and 1 placeholder with no network request', async function () {
		await browser.executeObsidian(() => {
			performance.clearResourceTimings();
			const w = window as typeof window & { pccFetches?: string[]; pccFetch?: typeof fetch };
			w.pccFetches = [];
			w.pccFetch = window.fetch;
			window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
				w.pccFetches!.push(String(input instanceof Request ? input.url : input));
				return w.pccFetch!(input, init);
			};
		});
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.cards.length === 6, 'expected 6 cards');
		await fillAll();
		const s = await waitFor((x) => x.cards.filter((c) => c.status === 'drawn').length === 5, '5 covers drawn');
		const network = await browser.executeObsidian(() => {
			const w = window as typeof window & { pccFetches?: string[]; pccFetch?: typeof fetch };
			window.fetch = w.pccFetch!;
			const fetches = w.pccFetches ?? [];
			delete w.pccFetch;
			delete w.pccFetches;
			const resources = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /^https?:/i.test(n));
			return { fetches, resources };
		});
		expect(network).toEqual({ fetches: [], resources: [] });
		expect(s.bar).toBe('6 cards, 3 with a PDF, 2 with an image');
		expect(s.cards.filter((c) => c.pdf !== null && c.status === 'drawn')).toHaveLength(3);
		const pottery = card(s, 'Pottery Notebook.md')!;
		const harbor = card(s, 'Harbor Postcards.md')!;
		expect([pottery.image, harbor.image]).toEqual(['Scans/Images/Pottery Notebook.jpg', 'Scans/Images/Harbor Postcards.png']);
		for (const c of [pottery, harbor]) {
			expect(c.status).toBe('drawn');
			expect(c.src).not.toMatch(/^(https?|data|blob):/);
			expect(c.button).toBe(false);
			expect(c.pagesLabel).toBe(false);
		}
		// The natural sizes: 600 x 800 and 800 x 560.
		expect(Math.abs(pottery.aspect - 800 / 600)).toBeLessThan(0.001);
		expect(Math.abs(harbor.aspect - 560 / 800)).toBeLessThan(0.001);
		expect(card(s, 'Letter from Aunt Ida.md')?.status).toBe('empty');
	});

	it('criterion 7: with the option off, the 2 image notes show the placeholder', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.cards.length === 6, 'expected 6 cards');
		await obsidianPage.write(BASE, baseText.replace('    cardWidth: 180', '    cardWidth: 180\n    showImages: false'));
		const s = await waitFor((x) => x.cards.length === 6 && x.cards.every((c) => c.image === null), 'no image covers');
		expect(s.cards.filter((c) => c.status === 'empty')).toHaveLength(3);
		expect(card(s, 'Pottery Notebook.md')?.status).toBe('empty');
		expect(card(s, 'Harbor Postcards.md')?.status).toBe('empty');
		expect(s.bar).toBe('6 cards, 3 with a PDF');
	});

	it('criterion 8: free, 40 PDF notes and 10 image notes draw 30 PDF covers and 10 image covers', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Mixed').catch(() => undefined);
			const pdfs = app.vault.getFiles().filter((f) => f.path.startsWith('Library/PDFs/')).map((f) => f.name).sort();
			const jobs: Promise<unknown>[] = [];
			for (let i = 0; i < 50; i++) {
				const link = i < 40 ? pdfs[i % pdfs.length] : i % 2 ? 'Pottery Notebook.jpg' : 'Harbor Postcards.png';
				jobs.push(app.vault.create(`Mixed/Item ${String(i).padStart(2, '0')}.md`, `---\ntags: [mixed]\nscan: "[[${link}]]"\n---\n`));
			}
			await Promise.all(jobs);
			await app.vault.create('Mixed/Mixed.base', 'filters:\n  and:\n    - file.hasTag("mixed")\nviews:\n  - type: pdf-cover-cards\n    name: Mixed\n    pdfProperty: note.scan\n    cardWidth: 120\n');
		});
		try {
			await obsidianPage.openFile('Mixed/Mixed.base');
			await waitFor((x) => x.cards.length === 50, 'expected 50 cards');
			await fillAll();
			const s = await waitFor((x) => x.cards.filter((c) => c.status === 'drawn').length === 40, '40 covers drawn', 60000);
			expect(s.cards.filter((c) => c.pdf !== null && c.status === 'drawn')).toHaveLength(30);
			expect(s.cards.filter((c) => c.image !== null && c.status === 'drawn')).toHaveLength(10);
			expect(s.cards.filter((c) => c.status === 'locked')).toHaveLength(10);
			expect(s.limitText).toContain('10 more covers are not drawn');
			expect(s.bar).toBe('50 cards, 40 with a PDF, 10 with an image');
		} finally {
			await browser.executeObsidian(async ({ app }) => {
				const folder = app.vault.getFolderByPath('Mixed');
				if (folder) await app.vault.delete(folder, true);
			});
		}
	});

	it('criterion 9: a damaged image shows "This image could not be read" and no loading indicator', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.create('Scans/Images/Broken photo.png', 'this is not an image');
			await app.vault.create('Scans/Broken photo.md', '---\ntags: [scan]\nscan: "[[Broken photo.png]]"\n---\n');
		});
		try {
			await obsidianPage.openFile(BASE);
			await waitFor((x) => x.cards.length === 7, 'expected 7 cards');
			await fillAll();
			const s = await waitFor((x) => card(x, 'Broken photo.md')?.status === 'error', 'error card');
			const broken = card(s, 'Broken photo.md')!;
			expect(broken.text).toContain('This image could not be read');
			expect(broken.loading).toBe(false);
			expect(broken.src).toBe('');
			expect(s.cards.filter((c) => c.status === 'drawn')).toHaveLength(5);
		} finally {
			await browser.executeObsidian(async ({ app }) => {
				for (const p of ['Scans/Broken photo.md', 'Scans/Images/Broken photo.png']) {
					const f = app.vault.getFileByPath(p);
					if (f) await app.vault.delete(f);
				}
			});
		}
	});

	it('criterion 10: a replaced image file shows on its card within 2 seconds', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.cards.length === 6, 'expected 6 cards');
		await fillAll();
		await waitFor((x) => card(x, 'Pottery Notebook.md')?.status === 'drawn', 'pottery drawn');
		const result = await browser.executeObsidian(async ({ app }, id) => {
			interface V {
				cards: { file: { path: string }; status: string; aspect: number }[];
				containerEl: HTMLElement;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const jpg = app.vault.getFileByPath('Scans/Images/Pottery Notebook.jpg')!;
			const png = app.vault.getFileByPath('Scans/Images/Harbor Postcards.png')!;
			const original = await app.vault.readBinary(jpg);
			const pottery = () => [...p.views].filter((v) => v.containerEl.isConnected && v.containerEl.offsetParent !== null).pop()?.cards.find((c) => c.file.path === 'Scans/Pottery Notebook.md');
			const t0 = performance.now();
			// The postcard bytes are landscape, so the new cover has another aspect.
			await app.vault.modifyBinary(jpg, await app.vault.readBinary(png));
			let ms = -1;
			while (performance.now() - t0 < 5000) {
				const c = pottery();
				if (c && c.status === 'drawn' && Math.abs(c.aspect - 560 / 800) < 0.001) {
					ms = performance.now() - t0;
					break;
				}
				await new Promise((r) => setTimeout(r, 20));
			}
			await app.vault.modifyBinary(jpg, original);
			return ms;
		}, pluginId);
		console.log(`image replace: new cover after ${Math.round(result)} ms`);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeLessThan(2000);
		await fillAll();
		await waitFor((x) => Math.abs((card(x, 'Pottery Notebook.md')?.aspect ?? 0) - 800 / 600) < 0.001, 'original image back');
	});

	it('criterion 11, Pro: the top half crop halves an image cover, and the contact sheet holds the image covers with titles', async function () {
		await setPro(true);
		try {
			await obsidianPage.openFile(BASE);
			await waitFor((x) => x.cards.length === 6, 'expected 6 cards');
			await fillAll();
			const whole = await waitFor((x) => card(x, 'Pottery Notebook.md')?.status === 'drawn' && card(x, 'Harbor Postcards.md')?.status === 'drawn', 'image covers drawn');
			await obsidianPage.write(BASE, baseText.replace('    cardWidth: 180', '    cardWidth: 180\n    crop: top-half'));
			await fillAll();
			const cropped = await waitFor((x) => Math.abs((card(x, 'Pottery Notebook.md')?.aspect ?? 0) - 400 / 600) < 0.001 && card(x, 'Harbor Postcards.md')?.status === 'drawn', 'cropped image covers');
			for (const name of ['Pottery Notebook.md', 'Harbor Postcards.md']) {
				const ratio = card(cropped, name)!.height / card(whole, name)!.height;
				console.log(`crop ${name}: ${card(whole, name)!.height} px to ${card(cropped, name)!.height} px`);
				expect(Math.abs(ratio - 0.5)).toBeLessThan(0.02);
			}
			const sheet = await browser.executeObsidian(async ({ app }, id) => {
				interface V {
					cards: { file: { path: string; basename: string }; status: string; aspect: number; image: string | null }[];
					containerEl: HTMLElement;
				}
				interface P {
					targetView(): V;
					exportSheet(v: V): Promise<{ path: string } | null>;
				}
				const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
				const v = p.targetView();
				const file = await p.exportSheet(v);
				if (!file) return null;
				const tfile = app.vault.getFileByPath(file.path)!;
				const bmp = await createImageBitmap(new Blob([await app.vault.readBinary(tfile)], { type: 'image/png' }));
				const canvas = document.createElement('canvas');
				canvas.width = bmp.width;
				canvas.height = bmp.height;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(bmp, 0, 0);
				// The same grid as the plugin: 5 columns of 240 px, 24 px gaps, 36 px title lines.
				const drawn = v.cards.filter((c) => c.status === 'drawn');
				const cells: { name: string; image: boolean; cover: number[]; title: number }[] = [];
				let y = 24;
				for (let row = 0; row < drawn.length; row += 5) {
					const items = drawn.slice(row, row + 5);
					const heights = items.map((c) => Math.round(240 * c.aspect));
					const rowHeight = Math.max(...heights);
					items.forEach((c, i) => {
						const x = 24 + i * 264;
						const px = ctx.getImageData(x + 120, y + Math.floor(heights[i]! / 2), 1, 1).data;
						// Dark pixels in the title line: the note name is drawn under the cover.
						const line = ctx.getImageData(x, y + rowHeight + 4, 240, 30).data;
						let dark = 0;
						for (let k = 0; k < line.length; k += 4) if (line[k]! < 120) dark++;
						cells.push({ name: c.file.basename, image: c.image !== null, cover: [px[0]!, px[1]!, px[2]!], title: dark });
					});
					y += rowHeight + 36 + 24;
				}
				app.workspace.getLeaf(false).detach();
				await app.vault.delete(tfile);
				return { width: bmp.width, height: bmp.height, cells };
			}, pluginId);
			expect(sheet).not.toBeNull();
			expect(sheet!.cells).toHaveLength(5);
			const images = sheet!.cells.filter((c) => c.image);
			expect(images.map((c) => c.name).sort()).toEqual(['Harbor Postcards', 'Pottery Notebook']);
			for (const c of sheet!.cells) {
				// Every cover cell has drawn pixels (not the white sheet) and a title.
				expect(c.cover.some((v) => v < 235)).toBe(true);
				expect(c.title).toBeGreaterThan(20);
			}
		} finally {
			await setPro(false);
		}
	});
});
