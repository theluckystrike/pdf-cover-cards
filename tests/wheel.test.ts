import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, loadPdfJs } from 'obsidian';
import { CoverRenderer } from '../src/render';
import { PdfCoverView, openPdfButton, viewOptions, type CardState } from '../src/view';

vi.mock('obsidian', async (importOriginal) => ({ ...(await importOriginal<typeof import('obsidian')>()), loadPdfJs: vi.fn() }));

const opts = { prop: null, useLinks: true, showImages: true, width: 180, showProps: true, crop: 'page' as const, wheel: true };

/** A view with drawn cards in one grid, as draw() leaves it with "Turn pages with the scroll wheel" on. */
async function setup(pagesOf: number[], slow = false) {
	const app = App.createConfigured__({ files: Object.fromEntries(pagesOf.map((_, i) => [`Doc ${i}.pdf`, ''])) });
	const grid = document.createElement('div');
	document.body.appendChild(grid);
	const cards: CardState[] = pagesOf.map((_, i) => {
		const cardEl = grid.createDiv();
		const coverEl = cardEl.createDiv({ cls: 'pdf-cover-card-cover' });
		const choice = { path: `Doc ${i}.pdf`, page: 1, from: 'property' as const };
		return { file: app.vault.getFileByPath(`Doc ${i}.pdf`)! as never, choice, image: null, coverEl, openEl: openPdfButton(cardEl, choice, vi.fn()), slot: true, status: 'waiting', aspect: 1.414, pages: 0 };
	});
	const gates: (() => void)[] = [];
	const cover = vi.fn(async (r: { file: { path: string }; page: number }) => {
		if (slow) await new Promise<void>((res) => gates.push(res));
		const pages = pagesOf[Number(/Doc (\d+)/.exec(r.file.path)![1])]!;
		return { blob: new Blob(['cover']), page: Math.min(r.page, pages), pages, aspect: 1.414 };
	});
	const view = Object.assign(Object.create(PdfCoverView.prototype) as PdfCoverView, {
		app, cards, token: 1, urls: [], plugin: { renderer: { cover }, settings: { saveCovers: false } }, options: () => opts,
		byCover: new WeakMap(cards.map((c) => [c.coverEl, c])), gesture: null,
	});
	// The listener of draw() for run 1 (the token above).
	grid.addEventListener('wheel', view.wheelListener(1), { passive: false });
	const wasSlow = slow;
	slow = false;
	await Promise.all(cards.map((c) => view.fill(c, 1, opts)));
	slow = wasSlow;
	const release = () => { while (gates.length) gates.shift()!(); };
	return { view, cards, cover, grid, release, setSlow: (v: boolean) => { slow = v; } };
}

let stamp = 1000;
function wheel(target: Element, init: WheelEventInit): WheelEvent {
	const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
	// Events in one test come 16 ms apart, like a trackpad.
	Object.defineProperty(evt, 'timeStamp', { value: (stamp += 16) });
	// happy-dom drops the modifier keys of WheelEventInit.
	for (const k of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const) Object.defineProperty(evt, k, { value: init[k] === true });
	target.dispatchEvent(evt);
	return evt;
}

describe('turn pages with the scroll wheel', () => {
	beforeEach(() => { vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(); });
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.empty();
	});

	it('is a view option, off by default', () => {
		const opt = viewOptions().find((o) => 'key' in o && o.key === 'wheelPages');
		expect(opt).toMatchObject({ type: 'toggle', displayName: 'Turn pages with the scroll wheel', default: false });
	});

	it('a horizontal swipe on the cover turns to the next page; the open button follows', async () => {
		const { cards, cover } = await setup([4]);
		const img = cards[0]!.coverEl.querySelector('img')!;
		const evt = wheel(img, { deltaX: 70 });
		expect(evt.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(cards[0]!.choice!.page).toBe(2));
		await vi.waitFor(() => expect(cards[0]!.status).toBe('drawn'));
		expect(cards[0]!.openEl!.textContent).toBe('Open at page 2');
		expect(cover).toHaveBeenCalledTimes(2);
	});

	it('Shift with the vertical wheel turns pages back and forth', async () => {
		const { cards } = await setup([4]);
		wheel(cards[0]!.coverEl, { deltaY: 100, shiftKey: true });
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 2).toBe(true));
		stamp += 1000;
		wheel(cards[0]!.coverEl, { deltaY: -100, shiftKey: true });
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 1).toBe(true));
	});

	it('a plain vertical scroll is not used: the base scrolls and the page stays', async () => {
		const { cards, cover } = await setup([4]);
		const evt = wheel(cards[0]!.coverEl, { deltaY: 300, deltaX: 20 });
		expect(evt.defaultPrevented).toBe(false);
		expect(cards[0]!.choice!.page).toBe(1);
		expect(cover).toHaveBeenCalledTimes(1);
	});

	it('Ctrl with the wheel (zoom) is not used', async () => {
		const { cards } = await setup([4]);
		expect(wheel(cards[0]!.coverEl, { deltaX: 300, ctrlKey: true }).defaultPrevented).toBe(false);
		expect(cards[0]!.choice!.page).toBe(1);
	});

	it('small deltas add up to one page; one event turns one page only', async () => {
		const { cards } = await setup([9]);
		expect(wheel(cards[0]!.coverEl, { deltaX: 20 }).defaultPrevented).toBe(true);
		wheel(cards[0]!.coverEl, { deltaX: 20 });
		expect(cards[0]!.target ?? 1).toBe(1);
		wheel(cards[0]!.coverEl, { deltaX: 25 });
		expect(cards[0]!.target).toBe(2);
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 2).toBe(true));
		stamp += 1000;
		wheel(cards[0]!.coverEl, { deltaX: 5000 });
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 3).toBe(true));
	});

	it('six fast pixel events of one gesture turn one page only', async () => {
		const { cards, cover } = await setup([9]);
		for (let i = 0; i < 6; i++) expect(wheel(cards[0]!.coverEl, { deltaX: 80 }).defaultPrevented).toBe(true);
		expect(cards[0]!.target).toBe(2);
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 2).toBe(true));
		expect(cover.mock.calls.map((c) => c[0].page)).toEqual([1, 2]);
	});

	it('wheel notches in line mode during a draw: one page each, and only the newest target draws', async () => {
		const { cards, cover, release, setSlow } = await setup([9]);
		setSlow(true);
		for (let i = 0; i < 6; i++) wheel(cards[0]!.coverEl, { deltaY: 3, deltaMode: 1, shiftKey: true });
		expect(cards[0]!.target).toBe(7);
		// Draw 1 is page 2 (asked before the other events), then the newest target, page 7.
		for (let i = 0; i < 4 && !(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 7); i++) {
			await vi.waitFor(() => expect(cover.mock.calls.length).toBeGreaterThan(1 + i));
			release();
			await new Promise((r) => setTimeout(r, 0));
		}
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 7).toBe(true));
		expect(cover.mock.calls.map((c) => c[0].page)).toEqual([1, 2, 7]);
		expect(cards[0]!.turning).toBe(false);
	});

	it("replays R6's trackpad traces: one light flick (248 px) and one firm swipe (488 px) turn exactly 1 page each", async () => {
		const flick = [3, 6, 11, 17, 22, 26, 24, 21, 18, 15, 13, 11, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1];
		const firm = [5, 12, 24, 38, 46, 44, 40, 35, 31, 27, 24, 21, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1];
		const { cards } = await setup([20]);
		for (const dx of flick) wheel(cards[0]!.coverEl, { deltaX: dx });
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && !cards[0]!.turning).toBe(true));
		expect(cards[0]!.choice!.page).toBe(2);
		stamp += 1000;
		for (const dx of firm) wheel(cards[0]!.coverEl, { deltaX: dx });
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && !cards[0]!.turning).toBe(true));
		expect(cards[0]!.choice!.page).toBe(3);
	});

	it('two gestures separated by more than 250 ms turn 2 pages; a pause of 200 ms does not end the gesture', async () => {
		const { cards } = await setup([9]);
		for (let i = 0; i < 5; i++) wheel(cards[0]!.coverEl, { deltaX: 30 });
		stamp += 200;
		for (let i = 0; i < 5; i++) wheel(cards[0]!.coverEl, { deltaX: 30 });
		expect(cards[0]!.target).toBe(2);
		stamp += 260;
		for (let i = 0; i < 5; i++) wheel(cards[0]!.coverEl, { deltaX: 30 });
		expect(cards[0]!.target).toBe(3);
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 3).toBe(true));
	});

	it('a vertical scroll with sideways drift never turns a page or blocks the scroll', async () => {
		const { cards, cover } = await setup([9]);
		// R6 probe E: 60 events down with drift, then 40 events of tail with dx 2, dy 1.
		const evs: WheelEventInit[] = [];
		for (let i = 0; i < 60; i++) evs.push({ deltaX: i % 3 === 0 ? 3 : 1, deltaY: i < 40 ? 20 : i % 3 === 0 ? 1 : 2 });
		for (let i = 0; i < 40; i++) evs.push({ deltaX: 2, deltaY: 1 });
		const prevented = evs.map((e) => wheel(cards[0]!.coverEl, e).defaultPrevented).filter(Boolean).length;
		expect(prevented).toBe(0);
		expect(cards[0]!.target ?? 1).toBe(1);
		expect(cover).toHaveBeenCalledTimes(1);
		// A sideways gesture with a small vertical drift turns one page. A vertical event in it is never blocked.
		stamp += 1000;
		expect(wheel(cards[0]!.coverEl, { deltaX: 40, deltaY: 5 }).defaultPrevented).toBe(true);
		expect(wheel(cards[0]!.coverEl, { deltaX: 25, deltaY: 30 }).defaultPrevented).toBe(false);
		expect(cards[0]!.target ?? 1).toBe(1);
		expect(wheel(cards[0]!.coverEl, { deltaX: 25, deltaY: 10 }).defaultPrevented).toBe(true);
		expect(cards[0]!.target).toBe(2);
	});

	it("replays R6 probe E2: a vertical scroll whose first event is sideways jitter is never blocked", async () => {
		const { cards, cover } = await setup([9]);
		const evs: WheelEventInit[] = [{ deltaX: 4, deltaY: 1 }, ...Array.from({ length: 30 }, () => ({ deltaX: 2, deltaY: 25 }))];
		const prevented = evs.map((e) => wheel(cards[0]!.coverEl, e).defaultPrevented).filter(Boolean).length;
		expect(prevented).toBe(0);
		expect(cards[0]!.target ?? 1).toBe(1);
		expect(cover).toHaveBeenCalledTimes(1);
	});

	it("replays R6 probe F: a sideways swipe less than 250 ms after a vertical momentum scroll turns 1 page", async () => {
		const { cards } = await setup([9]);
		for (let i = 0; i < 40; i++) expect(wheel(cards[0]!.coverEl, { deltaX: 0, deltaY: 10 }).defaultPrevented).toBe(false);
		const flick = [3, 6, 11, 17, 22, 26, 24, 21, 18, 15, 13, 11, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1];
		for (const dx of flick) wheel(cards[0]!.coverEl, { deltaX: dx });
		expect(cards[0]!.target).toBe(2);
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 2 && !cards[0]!.turning).toBe(true));
	});

	it('a mouse spin in pixel mode is one gesture: one page; a pause of more than 250 ms starts the next gesture', async () => {
		const { cards } = await setup([20]);
		// Shift + 3 notches 120 ms apart (Chromium sends 100 px a notch): one gesture, one page.
		for (let i = 0; i < 3; i++) {
			wheel(cards[0]!.coverEl, { deltaY: 100, shiftKey: true });
			stamp += 104;
		}
		expect(cards[0]!.target).toBe(2);
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 2 && !cards[0]!.turning).toBe(true));
		// A continuous spin of 10 notches 80 ms apart: one page.
		stamp += 1000;
		for (let i = 0; i < 10; i++) {
			wheel(cards[0]!.coverEl, { deltaY: 100, shiftKey: true });
			stamp += 64;
		}
		expect(cards[0]!.target).toBe(3);
		// Notches 300 ms apart are separate gestures: one page each.
		for (let i = 0; i < 3; i++) {
			stamp += 300;
			wheel(cards[0]!.coverEl, { deltaY: 100, shiftKey: true });
		}
		expect(cards[0]!.target).toBe(6);
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 6 && !cards[0]!.turning).toBe(true));
	});

	it("replays R6 round 3 stall traces (Chromium merges events of 48 to 80 ms): one swipe turns 1 page", async () => {
		const flick = [3, 6, 11, 17, 22, 26, 24, 21, 18, 15, 13, 11, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1];
		const firm = [5, 12, 24, 38, 46, 44, 40, 35, 31, 27, 24, 21, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1];
		const { cards } = await setup([40]);
		let page = 1;
		for (const [trace, at, frames] of [[firm, 5, 3], [firm, 5, 4], [flick, 6, 4], [firm, 8, 5]] as const) {
			stamp += 1000;
			for (let i = 0; i < trace.length; ) {
				if (i === at) {
					// One merged event after a stall: the sum of the frames, the time of the frames.
					stamp += 16 * (frames - 1);
					wheel(cards[0]!.coverEl, { deltaX: trace.slice(i, i + frames).reduce((a, b) => a + b, 0) });
					i += frames;
				} else wheel(cards[0]!.coverEl, { deltaX: trace[i++]! });
			}
			page++;
			expect(cards[0]!.target).toBe(page);
			await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === page && !cards[0]!.turning).toBe(true));
		}
	});

	it('no page draws after unload, also when the container stays', async () => {
		const { view, cards, cover } = await setup([4]);
		Object.assign(view, { plugin: { views: new Set() }, timer: null, observer: null });
		view.onunload();
		const evt = wheel(cards[0]!.coverEl, { deltaX: 80 });
		await new Promise((r) => setTimeout(r, 10));
		expect(evt.defaultPrevented).toBe(false);
		expect(cover).toHaveBeenCalledTimes(1);
		expect((view as unknown as { urls: string[] }).urls).toHaveLength(0);
	});

	it('stops at the last page and at page 1 without blocking the default scroll', async () => {
		const { cards, cover } = await setup([2]);
		wheel(cards[0]!.coverEl, { deltaX: 80 });
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 2).toBe(true));
		stamp += 1000;
		const past = wheel(cards[0]!.coverEl, { deltaX: 80 });
		expect(past.defaultPrevented).toBe(false);
		expect(cards[0]!.choice!.page).toBe(2);
		const back = wheel(cards[0]!.coverEl, { deltaX: -80 });
		expect(back.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === 1).toBe(true));
		stamp += 1000;
		expect(wheel(cards[0]!.coverEl, { deltaX: -80 }).defaultPrevented).toBe(false);
		expect(cover).toHaveBeenCalledTimes(3);
	});

	it('ignores 1-page PDFs, locked cards, image covers and the card body', async () => {
		const { view, cards, cover } = await setup([1, 4, 4]);
		expect(cards[0]!.pageControls).toBeUndefined();
		expect(wheel(cards[0]!.coverEl, { deltaX: 80 }).defaultPrevented).toBe(false);
		cards[1]!.slot = false;
		expect(wheel(cards[1]!.coverEl, { deltaX: 80 }).defaultPrevented).toBe(false);
		cards[2]!.choice = null;
		cards[2]!.image = 'scan.png';
		expect(wheel(cards[2]!.coverEl, { deltaX: 80 }).defaultPrevented).toBe(false);
		expect(wheel(cards[2]!.openEl!, { deltaX: 80 }).defaultPrevented).toBe(false);
		// A card of an older draw is not turned.
		const old = { ...cards[1]!, slot: true };
		view.cards = [cards[0]!];
		expect(wheel(old.coverEl, { deltaX: 80 }).defaultPrevented).toBe(false);
		expect(cover).toHaveBeenCalledTimes(3);
	});

	it('keeps one object URL for each card after 10 page turns, and unload revokes it', async () => {
		const { view, cards } = await setup([12]);
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		for (let i = 0; i < 10; i++) {
			stamp += 1000;
			wheel(cards[0]!.coverEl, { deltaX: 80 });
			await vi.waitFor(() => expect(cards[0]!.status === 'drawn' && cards[0]!.choice!.page === i + 2).toBe(true));
			expect((view as unknown as { urls: string[] }).urls).toHaveLength(1);
			expect(cards[0]!.coverEl.querySelectorAll('img')).toHaveLength(1);
		}
		expect(revoke).toHaveBeenCalledTimes(10);
		Object.assign(view, { plugin: { views: new Set() }, timer: null, observer: null });
		view.onunload();
		expect(revoke).toHaveBeenCalledTimes(11);
		expect((view as unknown as { urls: string[] }).urls).toHaveLength(0);
	});

	it('a redraw during a turn stops the turn and keeps no stale target', async () => {
		const { view, cards, release, setSlow } = await setup([4]);
		setSlow(true);
		wheel(cards[0]!.coverEl, { deltaX: 80 });
		const card = cards[0]!;
		// draw() makes new cards and a new token.
		view.cards = [];
		(view as unknown as { token: number }).token++;
		release();
		await vi.waitFor(() => expect(card.turning).toBe(false));
		expect(card.status).toBe('waiting');
	});
});

describe('pdf.js documents', () => {
	afterEach(() => { vi.restoreAllMocks(); });

	it('are destroyed after each drawn page and after a failed draw', async () => {
		const app = App.createConfigured__({ files: { 'Manual.pdf': '' } });
		const destroy = vi.fn(async () => undefined);
		let fail = false;
		const page = {
			getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
			render: () => ({ promise: fail ? Promise.reject(new Error('bad page')) : Promise.resolve() }),
		};
		vi.mocked(loadPdfJs).mockResolvedValue({ getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: async () => page, destroy }) }) });
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: () => undefined, fillStyle: '' } as never);
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(new Blob(['jpeg'])));
		vi.spyOn(app.vault, 'readBinary').mockResolvedValue(new ArrayBuffer(8));
		const renderer = new CoverRenderer(app as never, '.obsidian/plugins/pdf-cover-cards', () => ({ parallel: 2, pixelRatio: 1 }));
		const file = app.vault.getFileByPath('Manual.pdf')! as never;
		for (let p = 1; p <= 3; p++) await renderer.cover({ file, page: p, width: 180, crop: 'page', disk: false });
		expect(destroy).toHaveBeenCalledTimes(3);
		fail = true;
		await expect(renderer.cover({ file, page: 3, width: 200, crop: 'page', disk: false })).rejects.toThrow('bad page');
		expect(destroy).toHaveBeenCalledTimes(4);
	});
});
