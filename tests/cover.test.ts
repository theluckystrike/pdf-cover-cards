import { describe, expect, it } from 'vitest';
import { LruCache, MAX_AREA, MAX_SIDE, cacheKey, chooseCover, coverBox, coverFileName, coverSlots, cropShare, fnv1a, pageOf, pagesLabel, sheetLayout, sheetParts, type CoverInput } from '../src/cover';

const files = new Set(['Papers/Attention.pdf', 'Papers/Notes.pdf', 'Scans/Book scan.pdf', 'cover.png', 'Papers/Other.md']);
/** Resolves a link path the way the vault does for these tests: exact path, or a unique file name. */
const resolve = (linkpath: string): string | null => {
	if (files.has(linkpath)) return linkpath;
	const hits = [...files].filter((p) => p.endsWith(`/${linkpath}`));
	return hits.length === 1 ? hits[0]! : null;
};
const input = (over: Partial<CoverInput>): CoverInput => ({ self: { path: 'Library/Note.md', ext: 'md' }, property: [], links: [], useLinks: true, ...over });

describe('chooseCover', () => {
	it('uses the entry itself when it is a PDF', () => {
		expect(chooseCover(input({ self: { path: 'Scans/Book scan.pdf', ext: 'PDF' }, property: ['[[Attention.pdf]]'] }), resolve)).toEqual({ path: 'Scans/Book scan.pdf', page: 1, from: 'self' });
	});

	it('uses the first property value that resolves to a PDF, with its page', () => {
		expect(chooseCover(input({ property: ['[[Missing.pdf]]', '[[cover.png]]', '[[Attention.pdf#page=2]]'] }), resolve)).toEqual({ path: 'Papers/Attention.pdf', page: 2, from: 'property' });
	});

	it('falls back to the first PDF link of the note body', () => {
		expect(chooseCover(input({ links: ['Other', 'cover.png', 'Notes.pdf#page=5', 'Attention.pdf'] }), resolve)).toEqual({ path: 'Papers/Notes.pdf', page: 5, from: 'link' });
	});

	it('does not use body links when the option is off', () => {
		expect(chooseCover(input({ links: ['Notes.pdf'], useLinks: false }), resolve)).toBeNull();
	});

	it('the property wins over body links', () => {
		expect(chooseCover(input({ property: ['Scans/Book scan.pdf'], links: ['Notes.pdf'] }), resolve)?.path).toBe('Scans/Book scan.pdf');
	});

	it('gives null when nothing resolves', () => {
		expect(chooseCover(input({ property: ['[[Missing.pdf]]'], links: ['Nope.pdf'] }), resolve)).toBeNull();
	});

	it('rejects a link that resolves to a file that is not a PDF', () => {
		expect(chooseCover(input({ property: ['[[x.pdf]]'] }), () => 'Papers/Other.md')).toBeNull();
	});
});

describe('pageOf', () => {
	it('reads page= and falls back to 1', () => {
		expect(pageOf('#page=12')).toBe(12);
		expect(pageOf('#zoom=2&page=3')).toBe(3);
		expect(pageOf('')).toBe(1);
		expect(pageOf('#page=0')).toBe(1);
		expect(pageOf('#Heading')).toBe(1);
	});
});

describe('coverBox', () => {
	const a4 = { width: 595, height: 842 };

	it('scales the page to the card width times the pixel ratio', () => {
		const b = coverBox(a4, 180, 2, 'page');
		expect(b.width).toBe(360);
		expect(b.height).toBe(Math.floor(842 * (360 / 595)));
		expect(b.pageHeight).toBe(b.height);
	});

	it('clamps the pixel ratio to 1..3', () => {
		expect(coverBox(a4, 100, 0.5, 'page').width).toBe(100);
		expect(coverBox(a4, 100, 9, 'page').width).toBe(300);
		expect(coverBox(a4, 100, Number.NaN, 'page').width).toBe(100);
	});

	it('keeps the top part of the page for a crop', () => {
		const full = coverBox(a4, 200, 1, 'page');
		const half = coverBox(a4, 200, 1, 'top-half');
		const third = coverBox(a4, 200, 1, 'top-third');
		expect(half.width).toBe(full.width);
		expect(half.height).toBe(Math.floor(full.pageHeight / 2));
		expect(third.height).toBe(Math.floor(full.pageHeight / 3));
		expect(cropShare('page')).toBe(1);
	});

	it('never exceeds the side and area limits for a poster page', () => {
		const b = coverBox({ width: 5000, height: 20000 }, 400, 3, 'page');
		expect(b.width).toBeLessThanOrEqual(MAX_SIDE);
		expect(b.height).toBeLessThanOrEqual(MAX_SIDE);
		expect(b.width * b.height).toBeLessThanOrEqual(MAX_AREA);
		const wide = coverBox({ width: 20000, height: 500 }, 400, 3, 'page');
		expect(wide.width).toBeLessThanOrEqual(MAX_SIDE);
	});

	it('throws on a zero-size page or width', () => {
		expect(() => coverBox({ width: 0, height: 1 }, 100, 1, 'page')).toThrow();
		expect(() => coverBox(a4, 0, 1, 'page')).toThrow();
	});
});

describe('coverSlots', () => {
	it('gives the free limit without Pro and every card with Pro', () => {
		expect(coverSlots(12, false, 30)).toBe(12);
		expect(coverSlots(45, false, 30)).toBe(30);
		expect(coverSlots(45, true, 30)).toBe(45);
		expect(coverSlots(0, false, 30)).toBe(0);
		expect(() => coverSlots(-1, false, 30)).toThrow();
	});
});

describe('cache keys and file names', () => {
	it('changes when the PDF changes or the size or crop changes', () => {
		const k = cacheKey('a.pdf', 1, 100, 1, 360, 'page');
		expect(cacheKey('a.pdf', 2, 100, 1, 360, 'page')).not.toBe(k);
		expect(cacheKey('a.pdf', 1, 101, 1, 360, 'page')).not.toBe(k);
		expect(cacheKey('a.pdf', 1, 100, 2, 360, 'page')).not.toBe(k);
		expect(cacheKey('a.pdf', 1, 100, 1, 361, 'page')).not.toBe(k);
		expect(cacheKey('a.pdf', 1, 100, 1, 360, 'top-half')).not.toBe(k);
	});

	it('hashes with FNV-1a (known values) to a stable file name', () => {
		expect(fnv1a('')).toBe('811c9dc5');
		expect(fnv1a('a')).toBe('e40c292c');
		expect(fnv1a('foobar')).toBe('bf9cf968');
		expect(coverFileName('x')).toMatch(/^[0-9a-f]{16}\.jpg$/);
		expect(coverFileName('x')).toBe(coverFileName('x'));
		expect(coverFileName('x')).not.toBe(coverFileName('y'));
	});
});

describe('LruCache', () => {
	it('drops the least recently used values when over budget', () => {
		const c = new LruCache<string>(10);
		c.set('a', 'A', 4);
		c.set('b', 'B', 4);
		expect(c.get('a')).toBe('A');
		c.set('c', 'C', 4);
		expect(c.get('b')).toBeUndefined();
		expect(c.get('a')).toBe('A');
		expect(c.get('c')).toBe('C');
		expect(c.bytes).toBe(8);
	});

	it('replaces a key, skips a value larger than the budget and clears', () => {
		const c = new LruCache<number>(10);
		c.set('a', 1, 6);
		c.set('a', 2, 3);
		expect(c.bytes).toBe(3);
		c.set('big', 3, 11);
		expect(c.get('big')).toBeUndefined();
		expect(c.size).toBe(1);
		c.delete('a');
		expect(c.bytes).toBe(0);
		c.set('b', 4, 2);
		c.clear();
		expect(c.size).toBe(0);
		expect(() => new LruCache(0)).toThrow();
	});
});

describe('sheetLayout', () => {
	it('lays out rows as tall as their tallest cover', () => {
		const l = sheetLayout([1.5, 1, 2, 1.414], 3, 100, 10, 20);
		expect(l.width).toBe(10 + 3 * 110);
		expect(l.cells.map((c) => [c.x, c.y, c.coverHeight])).toEqual([
			[10, 10, 150],
			[120, 10, 100],
			[230, 10, 200],
			[10, 240, 141],
		]);
		expect(l.cells[0]!.titleY).toBe(10 + 200 + 15);
		expect(l.height).toBe(240 + 141 + 20 + 10);
	});

	it('uses fewer columns when there are fewer covers, and A4 for a bad aspect', () => {
		const l = sheetLayout([Number.NaN], 5, 100, 0, 0);
		expect(l.width).toBe(100);
		expect(l.cells[0]!.coverHeight).toBe(141);
		expect(() => sheetLayout([1], 0, 100, 0, 0)).toThrow();
	});
});

describe('sheetParts', () => {
	it('keeps a small view on one sheet', () => {
		expect(sheetParts([1.414, 1.414, 1.414], 5, 240, 24, 36, 12000)).toEqual([[0, 3]]);
		expect(sheetParts([], 5, 240, 24, 36, 12000)).toEqual([]);
	});

	it('splits a large view into sheets of whole rows that stay within the height limit', () => {
		const aspects = Array.from({ length: 1000 }, () => 1.414);
		const parts = sheetParts(aspects, 5, 240, 24, 36, 12000);
		expect(parts.length).toBeGreaterThan(1);
		expect(parts[0]![0]).toBe(0);
		expect(parts[parts.length - 1]![1]).toBe(1000);
		for (let i = 0; i < parts.length; i++) {
			const [start, end] = parts[i]!;
			if (i > 0) expect(start).toBe(parts[i - 1]![1]);
			if (end < 1000) expect((end - start) % 5).toBe(0);
			expect(sheetLayout(aspects.slice(start, end), 5, 240, 24, 36).height).toBeLessThanOrEqual(12000);
		}
	});

	it('gives a row that is taller than the limit a sheet of its own', () => {
		expect(sheetParts([1, 100, 1], 1, 240, 24, 36, 12000)).toEqual([[0, 1], [1, 2], [2, 3]]);
	});
});

describe('pagesLabel', () => {
	it('says page or pages', () => {
		expect(pagesLabel(1)).toBe('1 page');
		expect(pagesLabel(12)).toBe('12 pages');
	});
});
