import { $, browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Real-app checks of "Turn pages with the scroll wheel" (1.5.0). The 12 sample PDFs in Library/PDFs have 4 pages.
// Wheel/ gets a base with the option on, a note with a 1-page PDF, and later 200 distinct PDF files.
// Wheel events here are real WebDriver wheel actions, except one Shift event that the test dispatches.

interface CardInfo {
	path: string;
	status: string;
	page: number | null;
	pages: number;
	button: string | null;
	controls: number;
}

interface ViewState {
	cards: CardInfo[];
	/** scrollTop of the element that scrolls the cards. */
	scrollTop: number;
	scrollHeight: number;
	/** Object URLs that the view holds. */
	urls: number;
}

async function viewState(): Promise<ViewState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface Card {
			file: { path: string };
			choice: { page: number } | null;
			status: string;
			pages: number;
			coverEl: HTMLElement;
		}
		interface V {
			cards: Card[];
			urls: string[];
			containerEl: HTMLElement;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const v = [...(p?.views ?? [])].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.cards.length > 0).pop();
		if (!v) return null;
		// Only the visible view has the id, so selectors do not match a card of a hidden tab.
		document.querySelectorAll('#pcc-wheel-view').forEach((el) => { if (el !== v.containerEl) el.removeAttribute('id'); });
		v.containerEl.id = 'pcc-wheel-view';
		// The nearest element that can scroll the cards: the view container or a parent.
		let s: HTMLElement | null = v.containerEl;
		while (s && s.scrollHeight <= s.clientHeight + 1) s = s.parentElement;
		return {
			cards: v.cards.map((c) => ({
				path: c.file.path,
				status: c.status,
				page: c.choice?.page ?? null,
				pages: c.pages,
				button: c.coverEl.parentElement?.querySelector('.pdf-cover-card-open-pdf')?.textContent ?? null,
				controls: c.coverEl.parentElement?.querySelectorAll('.pdf-cover-card-navigation button').length ?? 0,
			})),
			scrollTop: s?.scrollTop ?? 0,
			scrollHeight: s?.scrollHeight ?? 0,
			urls: v.urls.length,
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

/** A valid 1-page PDF with a gray page, as text (all ASCII). */
function onePagePdf(): string {
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 560] /Contents 4 0 R >>',
	];
	const content = '0.6 g 0 0 400 560 re f';
	objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objs.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return out;
}

/** Draws the visible view again (as a note edit does) and then every cover within the limit. */
async function redrawAll(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		interface V { cards: unknown[]; containerEl: HTMLElement; draw(): void; fillAll(): Promise<void> }
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
		const v = [...p.views].filter((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null && x.cards.length > 0).pop();
		v?.draw();
		await v?.fillAll();
	}, pluginId);
}

const card = (s: ViewState, name: string) => s.cards.find((c) => c.path.endsWith(`/${name}`));
const coverSel = (path: string) => `#pcc-wheel-view .pdf-cover-card[data-path="${path}"] .pdf-cover-card-cover`;
const coverOf = (path: string) => $(coverSel(path));

/** Records each wheel event that reaches the window: consumed (defaultPrevented) or not, with its deltas. */
async function watchWheel(): Promise<void> {
	await browser.executeObsidian(() => {
		const w = window as typeof window & { pccWheel?: boolean[]; pccWheelInfo?: string[]; pccWheelStop?: () => void };
		w.pccWheelStop?.();
		w.pccWheel = [];
		w.pccWheelInfo = [];
		const on = (e: WheelEvent) => {
			w.pccWheel!.push(e.defaultPrevented);
			w.pccWheelInfo!.push(`${e.deltaX},${e.deltaY},${e.deltaMode},${e.shiftKey},${e.defaultPrevented}`);
		};
		window.addEventListener('wheel', on);
		w.pccWheelStop = () => window.removeEventListener('wheel', on);
	});
}
async function wheelLog(): Promise<boolean[]> {
	const w = await browser.executeObsidian(() => {
		const x = window as typeof window & { pccWheel?: boolean[]; pccWheelInfo?: string[] };
		return { log: x.pccWheel ?? [], info: x.pccWheelInfo ?? [] };
	});
	console.log(`wheel e2e: events ${w.info.join(' | ')}`);
	return w.log;
}

/** Scrolls an element into view with the DOM method. The WebDriver scrollIntoView sends a wheel action, which can turn a page. */
async function domScrollIntoView(selector: string): Promise<void> {
	const found = await browser.executeObsidian((_o, sel) => {
		const el = document.querySelector(sel);
		el?.scrollIntoView({ block: 'center' });
		return el !== null;
	}, selector);
	if (!found) throw new Error(`no element ${selector}`);
	await browser.pause(150);
}

async function realWheel(path: string, deltaX: number, deltaY: number): Promise<void> {
	await viewState();
	await domScrollIntoView(coverSel(path));
	const el = await coverOf(path);
	await browser.action('wheel').scroll({ origin: el, deltaX, deltaY, duration: 0 }).perform();
}

const BASE = 'Wheel/Wheel.base';
const CAMERA = 'Library/Camera Basics.md';

describe(`${pluginId} turns pages with the scroll wheel in the real app`, function () {
	before(async function () {
		await setPro(false);
		await browser.executeObsidian(async ({ app }, pdf) => {
			await app.vault.createFolder('Wheel').catch(() => undefined);
			if (!app.vault.getFileByPath('Wheel/One page.pdf')) await app.vault.create('Wheel/One page.pdf', pdf);
			if (!app.vault.getFileByPath('Wheel/Leaflet.md')) await app.vault.create('Wheel/Leaflet.md', '---\ntags: [wheel]\npdf: "[[One page.pdf]]"\n---\n');
			if (!app.vault.getFileByPath('Wheel/Wheel.base')) {
				await app.vault.create('Wheel/Wheel.base', 'filters:\n  or:\n    - file.hasTag("library")\n    - file.hasTag("wheel")\nviews:\n  - type: pdf-cover-cards\n    name: Wheel\n    order:\n      - file.name\n    pdfProperty: note.pdf\n    cardWidth: 180\n    wheelPages: true\n');
			}
		}, onePagePdf());
	});

	it('A6: a real horizontal wheel on a cover turns to the next page; a vertical wheel does not', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.cards.length === 13, '13 cards');
		await redrawAll();
		await waitFor((x) => card(x, 'Camera Basics.md')?.status === 'drawn', 'Camera Basics drawn');
		await watchWheel();
		await realWheel(CAMERA, 0, 120);
		await browser.pause(400);
		let s = (await viewState())!;
		expect(card(s, 'Camera Basics.md')!.page).toBe(1);
		const log = await wheelLog();
		expect(log.length).toBeGreaterThan(0);
		expect(log.every((x) => x === false)).toBe(true);
		await watchWheel();
		await realWheel(CAMERA, 120, 0);
		s = await waitFor((x) => card(x, 'Camera Basics.md')?.page === 2 && card(x, 'Camera Basics.md')?.status === 'drawn', 'page 2 after a horizontal wheel');
		expect(card(s, 'Camera Basics.md')!.button).toBe('Open at page 2');
		expect((await wheelLog()).some((x) => x === true)).toBe(true);
		// Shift with the vertical wheel, as the OS sends it on Windows and Linux. A new gesture: more than 250 ms later.
		await browser.pause(400);
		await browser.executeObsidian(() => {
			const el = document.querySelector('#pcc-wheel-view .pdf-cover-card[data-path="Library/Camera Basics.md"] .pdf-cover-card-cover')!;
			el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, shiftKey: true, bubbles: true, cancelable: true }));
		});
		await waitFor((x) => card(x, 'Camera Basics.md')?.page === 3 && card(x, 'Camera Basics.md')?.status === 'drawn', 'page 3 after Shift and the wheel');
	});

	it('A8: after a wheel turn, an edited link wins: #page=3, then #page=99 (last page), then #page=abc (page 1)', async function () {
		const before = await obsidianPage.read(CAMERA);
		try {
			await obsidianPage.openFile(BASE);
			await waitFor((x) => x.cards.length === 13, '13 cards');
			await redrawAll();
			await waitFor((x) => card(x, 'Camera Basics.md')?.page === 1 && card(x, 'Camera Basics.md')?.status === 'drawn', 'Camera Basics drawn at page 1');
			await realWheel(CAMERA, 120, 0);
			await waitFor((x) => card(x, 'Camera Basics.md')?.page === 2 && card(x, 'Camera Basics.md')?.status === 'drawn', 'page 2 after the wheel');
			for (const [link, page] of [['#page=3', 3], ['#page=99', 4], ['#page=abc', 1], ['#page=2', 2]] as const) {
				await obsidianPage.write(CAMERA, before.replace('[[Camera Basics.pdf]]', `[[Camera Basics.pdf${link}]]`));
				const s = await waitFor((x) => card(x, 'Camera Basics.md')?.page === page && card(x, 'Camera Basics.md')?.status === 'drawn', `${link} shows page ${page}`);
				expect(card(s, 'Camera Basics.md')!.button).toBe(`Open at page ${page}`);
			}
			// The wheel goes on from the page of the edited link.
			await realWheel(CAMERA, 120, 0);
			await waitFor((x) => card(x, 'Camera Basics.md')?.page === 3 && card(x, 'Camera Basics.md')?.status === 'drawn', 'page 3 after the edit and the wheel');
		} finally {
			await obsidianPage.write(CAMERA, before);
		}
		await waitFor((x) => card(x, 'Camera Basics.md')?.page === 1, 'back to page 1');
	});

	it('A9: a 1-page PDF has no page controls and the wheel on it is not consumed', async function () {
		await obsidianPage.openFile(BASE);
		await waitFor((x) => x.cards.length === 13, '13 cards');
		await redrawAll();
		const s = await waitFor((x) => card(x, 'Leaflet.md')?.status === 'drawn', 'Leaflet drawn');
		expect(card(s, 'Leaflet.md')!.pages).toBe(1);
		expect(card(s, 'Leaflet.md')!.controls).toBe(0);
		await watchWheel();
		await realWheel('Wheel/Leaflet.md', 120, 0);
		await browser.pause(400);
		expect((await wheelLog()).every((x) => x === false)).toBe(true);
		expect(card((await viewState())!, 'Leaflet.md')!.page).toBe(1);
	});

	it('A10 and A7: 200 PDFs draw lazily without a long freeze; a page turn keeps the scroll position; unload frees the covers', async function () {
		await setPro(true);
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Wheel200').catch(() => undefined);
			const sources = app.vault.getFiles().filter((f) => f.path.startsWith('Library/PDFs/')).sort((a, b) => a.path.localeCompare(b.path));
			const bytes = await Promise.all(sources.map((f) => app.vault.readBinary(f)));
			const jobs: Promise<unknown>[] = [];
			for (let i = 0; i < 200; i++) {
				const path = `Wheel200/Doc ${String(i).padStart(3, '0')}.pdf`;
				if (!app.vault.getFileByPath(path)) jobs.push(app.vault.createBinary(path, bytes[i % bytes.length]!));
			}
			await Promise.all(jobs);
			if (!app.vault.getFileByPath('Wheel200/Wheel200.base')) {
				await app.vault.create('Wheel200/Wheel200.base', 'filters:\n  and:\n    - file.inFolder("Wheel200")\n    - file.ext == "pdf"\nviews:\n  - type: pdf-cover-cards\n    name: Many\n    cardWidth: 180\n    wheelPages: true\n');
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { renderer: { memory: { clear(): void } } }> } }).plugins.plugins['pdf-cover-cards']!;
			p.renderer.memory.clear();
		});
		await obsidianPage.openFile('Wheel200/Wheel200.base');
		await waitFor((x) => x.cards.length === 200 && x.cards.some((c) => c.status === 'drawn'), '200 cards, first covers', 60000);
		await browser.pause(1500);
		const early = (await viewState())!;
		const drawnEarly = early.cards.filter((c) => c.status === 'drawn').length;
		console.log(`wheel e2e: ${drawnEarly} of 200 covers drawn before scrolling`);
		expect(drawnEarly).toBeLessThan(200);
		expect(early.urls).toBe(drawnEarly);
		// Scroll to the end in steps while a timer measures the longest gap of the main thread.
		const gap = await browser.executeObsidian(async () => {
			let s: HTMLElement | null = document.querySelector<HTMLElement>('#pcc-wheel-view');
			while (s && s.scrollHeight <= s.clientHeight + 1) s = s.parentElement;
			let last = performance.now();
			let max = 0;
			const t = window.setInterval(() => {
				const now = performance.now();
				max = Math.max(max, now - last);
				last = now;
			}, 16);
			for (let i = 0; i < 400 && s && s.scrollTop + s.clientHeight < s.scrollHeight - 2; i++) {
				s.scrollTop += 300;
				await new Promise((r) => setTimeout(r, 60));
			}
			await new Promise((r) => setTimeout(r, 300));
			window.clearInterval(t);
			return { max: Math.round(max), scrolled: s?.scrollTop ?? 0 };
		});
		console.log(`wheel e2e: longest main thread gap while scrolling 200 cards ${gap.max} ms, scrollTop ${gap.scrolled}`);
		expect(gap.scrolled).toBeGreaterThan(0);
		expect(gap.max).toBeLessThan(1000);
		const all = await waitFor((x) => x.cards.filter((c) => c.status === 'drawn').length === 200, 'all 200 covers', 120000);
		expect(all.urls).toBe(200);
		// A7: in the middle of the base, a page turn keeps the scroll position; a vertical wheel scrolls.
		const mid = 'Wheel200/Doc 100.pdf';
		await viewState();
		await domScrollIntoView(coverSel(mid));
		const top0 = (await viewState())!.scrollTop;
		expect(top0).toBeGreaterThan(0);
		await browser.action('wheel').scroll({ origin: await coverOf(mid), deltaX: 120, deltaY: 0, duration: 0 }).perform();
		const turned = await waitFor((x) => card(x, 'Doc 100.pdf')?.page === 2 && card(x, 'Doc 100.pdf')?.status === 'drawn', 'Doc 100 page 2');
		expect(turned.scrollTop).toBe(top0);
		expect(turned.urls).toBe(200);
		await browser.pause(400);
		await browser.action('wheel').scroll({ origin: await coverOf(mid), deltaX: 0, deltaY: 200, duration: 0 }).perform();
		const moved = await waitFor((x) => x.scrollTop !== top0, 'a vertical wheel scrolls the base', 5000);
		expect(card(moved, 'Doc 100.pdf')!.page).toBe(2);
		// Unload: closing the tab revokes all object URLs of the view.
		const left = await browser.executeObsidian(async ({ app }, id) => {
			interface V { urls: string[]; containerEl: HTMLElement }
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.views].find((x) => x.containerEl.id === 'pcc-wheel-view')!;
			app.workspace.getMostRecentLeaf()?.detach();
			await new Promise((r) => setTimeout(r, 500));
			return { urls: v.urls.length, registered: p.views.has(v) };
		}, pluginId);
		expect(left).toEqual({ urls: 0, registered: false });
	});

	after(async function () {
		await setPro(false);
		await browser.executeObsidian(async ({ app }) => {
			for (const folder of ['Wheel200', 'Wheel']) {
				const f = app.vault.getFolderByPath(folder);
				if (f) await app.vault.delete(f, true);
			}
		});
	});
});
