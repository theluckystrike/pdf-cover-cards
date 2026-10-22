import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { barText, cardStatuses, chooseCover, chooseImage, coverSlots, imageAspect, imageTarget, isImagePath, type CoverInput } from '../src/cover';
import { PdfCoverView, type CardState } from '../src/view';

const files = new Set(['Scans/Moss.jpg', 'My Scan.png', '100%25 scan.png', 'Cover.webp', 'notes.md', 'Papers/Attention.pdf', 'Scans/Kiln.PNG']);
/** Resolves a link path the way the vault does for these tests: exact path, or a unique file name. */
const resolve = (linkpath: string): string | null => {
	if (files.has(linkpath)) return linkpath;
	const hits = [...files].filter((p) => p.endsWith(`/${linkpath}`));
	return hits.length === 1 ? hits[0]! : null;
};
const input = (over: Partial<CoverInput>): CoverInput => ({ self: { path: 'Library/Note.md', ext: 'md' }, property: [], links: [], useLinks: true, ...over });

describe('chooseImage (criteria 1 to 4)', () => {
	it('criterion 1: reads wiki, Markdown and literal percent paths', () => {
		expect(chooseImage(input({ property: ['[[Scans/Moss.jpg]]'] }), resolve)).toBe('Scans/Moss.jpg');
		expect(chooseImage(input({ property: ['[x](My%20Scan.png)'] }), resolve)).toBe('My Scan.png');
		expect(chooseImage(input({ property: ['[[100%25 scan.png]]'] }), resolve)).toBe('100%25 scan.png');
	});

	it('criterion 2: an image entry is its own cover; URLs and notes give null', () => {
		expect(chooseImage(input({ self: { path: 'Cover.webp', ext: 'webp' } }), resolve)).toBe('Cover.webp');
		expect(chooseImage(input({ property: ['https://example.com/a.png'] }), resolve)).toBeNull();
		expect(chooseImage(input({ property: ['[[notes.md]]'] }), resolve)).toBeNull();
	});

	it('criterion 3: a PDF property wins over an image embed', () => {
		const note = input({ property: ['[[Attention.pdf]]'], links: ['Scans/Moss.jpg'] });
		expect(chooseCover(note, resolve)).toEqual({ path: 'Papers/Attention.pdf', page: 1, from: 'property' });
	});

	it('criterion 4: with "Use the first PDF link in the note" off, a body image embed gives null', () => {
		expect(chooseImage(input({ links: ['Scans/Moss.jpg'], useLinks: false }), resolve)).toBeNull();
		expect(chooseImage(input({ links: ['Scans/Moss.jpg'], useLinks: true }), resolve)).toBe('Scans/Moss.jpg');
	});

	it('uses the property before the body and skips values that are not images', () => {
		expect(chooseImage(input({ property: ['[[Missing.png]]', '[[notes.md]]', '![[Kiln.PNG|200]]'], links: ['Scans/Moss.jpg'] }), resolve)).toBe('Scans/Kiln.PNG');
		expect(chooseImage(input({ links: ['notes', 'Moss.jpg#crop'] }), resolve)).toBe('Scans/Moss.jpg');
	});

	it('rejects a link that resolves to a file that is not an image', () => {
		expect(chooseImage(input({ property: ['[[x.png]]'] }), () => 'notes.md')).toBeNull();
	});
});

describe('image link rules', () => {
	it('accepts the 8 extensions in any case', () => {
		for (const ext of ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp', 'JPG', 'WebP']) expect(isImagePath(`a.${ext}`)).toBe(true);
		for (const p of ['a.pdf', 'a.tiff', 'a.heic', 'png', 'a.png.md', '']) expect(isImagePath(p)).toBe(false);
	});

	it('ignores the subpath and rejects every scheme', () => {
		expect(imageTarget('[[Moss.jpg#crop|300]]')).toBe('Moss.jpg');
		expect(imageTarget('[a](<Scans/A (1).png#x>)')).toBe('Scans/A (1).png');
		for (const url of ['https://example.com/a.png', 'http://x/a.jpg', 'data:image/png;base64,AAAA.png', 'file:///a.png', '[x](https://example.com/a.png)', 'app://local/a.png']) {
			expect(imageTarget(url)).toBeNull();
		}
	});
});

describe('slots and bar text (criteria 5 and the bar)', () => {
	it('criterion 5: 40 PDF cards and 10 image cards give 30 free slots', () => {
		expect(coverSlots(40, false, 30)).toBe(30);
		const kinds = Array.from({ length: 50 }, (_, i) => (i % 5 === 4 ? 'image' : 'pdf') as 'image' | 'pdf');
		const s = cardStatuses(kinds, false, 30);
		expect(s.filter((x, i) => kinds[i] === 'pdf' && x === 'waiting')).toHaveLength(30);
		expect(s.filter((x) => x === 'locked')).toHaveLength(10);
		expect(s.filter((x, i) => kinds[i] === 'image' && x === 'waiting')).toHaveLength(10);
		expect(cardStatuses(kinds, true, 30).every((x) => x === 'waiting')).toBe(true);
		expect(cardStatuses([null, 'image', 'pdf'], false, 0)).toEqual(['empty', 'waiting', 'locked']);
	});

	it('names the image covers only when there are some', () => {
		expect(barText(6, 3, 2)).toBe('6 cards, 3 with a PDF, 2 with an image');
		expect(barText(12, 12, 0)).toBe('12 cards, 12 with a PDF');
		expect(barText(1, 0, 0)).toBe('1 card, 0 with a PDF');
	});

	it('keeps the image aspect, applies the crop share and rejects a bad size', () => {
		expect(imageAspect(400, 600, 'page')).toBe(1.5);
		expect(imageAspect(400, 600, 'top-half')).toBe(0.75);
		expect(imageAspect(300, 300, 'top-third')).toBeCloseTo(1 / 3);
		for (const [w, h] of [[0, 10], [10, 0], [Number.NaN, 10], [Infinity, 10], [-1, 5]] as const) expect(() => imageAspect(w, h, 'page')).toThrow();
	});
});

/** A view with a fake base: entries, view options and a metadata cache. No Obsidian app. */
function fakeView(entries: { path: string; fm?: Record<string, unknown>; embeds?: string[] }[], config: Record<string, unknown> = {}, pro = false) {
	const vaultFiles = new Map<string, { path: string; name: string; basename: string; extension: string; stat: { mtime: number; size: number } }>();
	const add = (path: string) => {
		const name = path.split('/').pop()!;
		const dot = name.lastIndexOf('.');
		vaultFiles.set(path, { path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1), stat: { mtime: 1, size: 1 } });
	};
	for (const p of ['Scans/A.pdf', 'Scans/B.pdf', 'Scans/C.pdf', 'Scans/Moss.jpg', 'Scans/Kiln.png']) add(p);
	for (const e of entries) add(e.path);
	const caches = new Map(entries.map((e) => [e.path, {
		frontmatter: e.fm,
		frontmatterLinks: Object.entries(e.fm ?? {}).flatMap(([key, v]) => (typeof v === 'string' && v.startsWith('[[') ? [{ key, link: v.slice(2, -2) }] : [])),
		embeds: (e.embeds ?? []).map((link, i) => ({ link, position: { start: { offset: i } } })),
	}]));
	const app = {
		metadataCache: {
			getFileCache: (f: { path: string }) => caches.get(f.path) ?? null,
			getFirstLinkpathDest: (link: string) => vaultFiles.get(link) ?? [...vaultFiles.values()].find((f) => f.name === link) ?? null,
		},
		vault: { getFileByPath: (p: string) => vaultFiles.get(p) ?? null, getResourcePath: (f: { path: string }) => `app://local/${f.path}` },
	};
	const cfg = { pdfProperty: 'note.pdf', showProps: false, ...config };
	const view = Object.assign(Object.create(PdfCoverView.prototype) as PdfCoverView, {
		app,
		containerEl: document.createElement('div'),
		cards: [],
		urls: [],
		token: 0,
		plugin: { renderer: { cover: vi.fn() }, settings: { saveCovers: false }, pro: { isPro: () => pro } },
		data: { data: entries.map((e) => ({ file: vaultFiles.get(e.path), getValue: () => null })) },
		config: {
			get: (k: string) => cfg[k as keyof typeof cfg],
			getAsPropertyId: (k: string) => (k === 'pdfProperty' ? cfg.pdfProperty : null),
			getOrder: () => [],
			getDisplayName: (p: string) => p,
		},
	});
	return view;
}

describe('the view with PDF and image scans', () => {
	beforeEach(() => {
		vi.stubGlobal('IntersectionObserver', class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const shelf = [
		{ path: 'S/1.md', fm: { pdf: '[[A.pdf]]' } },
		{ path: 'S/2.md', fm: { pdf: '[[B.pdf]]' }, embeds: ['Moss.jpg'] },
		{ path: 'S/3.md', embeds: ['C.pdf'] },
		{ path: 'S/4.md', fm: { pdf: '[[Moss.jpg]]' } },
		{ path: 'S/5.md', embeds: ['Kiln.png'] },
		{ path: 'S/6.md' },
	];

	it('gives 3 PDF cards, 2 image cards and 1 placeholder, and says so in the bar', () => {
		const view = fakeView(shelf);
		view.draw();
		expect(view.cards.map((c) => [c.choice?.path ?? null, c.image, c.status])).toEqual([
			['Scans/A.pdf', null, 'waiting'],
			// Criterion 3: the PDF property wins over the image embed.
			['Scans/B.pdf', null, 'waiting'],
			['Scans/C.pdf', null, 'waiting'],
			[null, 'Scans/Moss.jpg', 'waiting'],
			[null, 'Scans/Kiln.png', 'waiting'],
			[null, null, 'empty'],
		]);
		expect(view.containerEl.querySelector('.pdf-cover-cards-bar')?.textContent).toBe('6 cards, 3 with a PDF, 2 with an image');
		// An image card has no Open at page button.
		expect(view.containerEl.querySelectorAll('.pdf-cover-card-open-pdf')).toHaveLength(3);
	});

	it('criterion 7: with the option off, the image notes show the placeholder', () => {
		const view = fakeView(shelf, { showImages: false });
		view.draw();
		expect(view.cards.filter((c) => c.status === 'empty')).toHaveLength(3);
		expect(view.cards.every((c) => c.image === null)).toBe(true);
		expect(view.containerEl.querySelector('.pdf-cover-cards-bar')?.textContent).toBe('6 cards, 3 with a PDF');
	});

	it('criterion 8 and 13: 40 PDF notes and 10 image notes lock 10 PDF covers and draw every image', () => {
		const notes = Array.from({ length: 50 }, (_, i) => ({ path: `B/${String(i).padStart(2, '0')}.md`, fm: { pdf: i < 40 ? '[[A.pdf]]' : '[[Kiln.png]]' } }));
		const view = fakeView(notes);
		view.draw();
		expect(view.cards.filter((c) => c.choice && c.status === 'waiting')).toHaveLength(30);
		expect(view.cards.filter((c) => c.status === 'locked')).toHaveLength(10);
		expect(view.cards.filter((c) => c.image && c.status === 'waiting' && c.slot)).toHaveLength(10);
		expect(view.containerEl.querySelector('.pdf-cover-cards-limit')?.textContent).toContain('10 more covers are not drawn');
	});
});

describe('drawing an image cover', () => {
	afterEach(() => vi.restoreAllMocks());

	function imageCard(): { view: PdfCoverView; card: CardState; app: App } {
		const app = App.createConfigured__({ files: { 'Scans/Moss.jpg': '', 'Moss.md': '' } });
		const cover = vi.fn();
		const card: CardState = { file: app.vault.getFileByPath('Moss.md')! as never, choice: null, image: 'Scans/Moss.jpg',
			coverEl: document.createElement('div'), slot: true, status: 'waiting', aspect: 1.414, pages: 0 };
		card.coverEl.addClass('is-loading');
		const view = Object.assign(Object.create(PdfCoverView.prototype) as PdfCoverView, {
			app, cards: [card], token: 1, urls: [], plugin: { renderer: { cover }, settings: { saveCovers: true } } });
		return { view, card, app };
	}
	const opts = (crop: 'page' | 'top-half' = 'page') => ({ prop: null, useLinks: true, showImages: true, width: 180, showProps: true, crop });

	it('uses the vault resource URL and the natural size, with no PDF render, page count or page controls', async () => {
		vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue();
		vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400);
		vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(600);
		const { view, card, app } = imageCard();
		const resource = vi.spyOn(app.vault, 'getResourcePath');
		await view.fill(card, 1, opts());
		expect(resource).toHaveBeenCalledTimes(1);
		expect(card.status).toBe('drawn');
		expect(card.aspect).toBe(1.5);
		expect(card.coverEl.style.getPropertyValue('--pdf-cover-cards-aspect')).toBe('1.5');
		expect(card.coverEl.querySelectorAll('img')).toHaveLength(1);
		expect(card.coverEl.querySelector('img')!.getAttribute('src')).toBe(app.vault.getResourcePath(app.vault.getFileByPath('Scans/Moss.jpg')!));
		expect(card.coverEl.hasClass('is-loading')).toBe(false);
		expect(card.coverEl.querySelector('.pdf-cover-card-pages')).toBeNull();
		expect(card.pageControls).toBeUndefined();
		expect((view as unknown as { plugin: { renderer: { cover: ReturnType<typeof vi.fn> } } }).plugin.renderer.cover).not.toHaveBeenCalled();
		await view.changePage(card, 1);
		expect(card.status).toBe('drawn');
	});

	it('criterion 16: the Pro crop keeps the top share of the image', async () => {
		vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue();
		vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400);
		vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(600);
		const { view, card } = imageCard();
		await view.fill(card, 1, opts('top-half'));
		expect(card.aspect).toBe(0.75);
	});

	it('criteria 9 and 10: a damaged image shows the message without a loading indicator', async () => {
		vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new Error('EncodingError'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { view, card } = imageCard();
		await view.fill(card, 1, opts());
		expect(card.status).toBe('error');
		expect(card.coverEl.textContent).toContain('This image could not be read');
		expect(card.coverEl.hasClass('is-loading')).toBe(false);
		expect(card.coverEl.querySelectorAll('img')).toHaveLength(0);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('rejects a zero natural size', async () => {
		vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue();
		vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { view, card } = imageCard();
		await view.fill(card, 1, opts());
		expect(card.status).toBe('error');
	});

	it('criterion 18: fails closed with one warning when the vault gives no resource URL', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		for (let i = 0; i < 2; i++) {
			const { view, card, app } = imageCard();
			vi.spyOn(app.vault, 'getResourcePath').mockImplementation(() => { throw new Error('no resource path'); });
			await view.fill(card, 1, opts());
			expect(card.status).toBe('error');
			expect(card.coverEl.textContent).toContain('This image could not be read');
		}
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('adds one image when the observer and fillAll decode at the same time, and none after a redraw', async () => {
		let finish!: () => void;
		vi.spyOn(HTMLImageElement.prototype, 'decode').mockReturnValue(new Promise<void>((r) => { finish = r; }));
		vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100);
		vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(100);
		const { view, card } = imageCard();
		(view as unknown as { options: () => ReturnType<typeof opts> }).options = () => opts();
		const a = view.fill(card, 1, opts());
		const b = view.fillAll();
		finish();
		await Promise.all([a, b]);
		expect(card.coverEl.querySelectorAll('img')).toHaveLength(1);
		const stale = imageCard();
		const c = stale.view.fill(stale.card, 1, opts());
		(stale.view as unknown as { token: number }).token = 2;
		await c;
		expect(stale.card.coverEl.querySelectorAll('img')).toHaveLength(0);
		expect(stale.card.status).toBe('waiting');
	});
});
