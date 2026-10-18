import { describe, expect, it } from 'vitest';
import { coverTarget, coverBox } from '../src/cover';

describe('PDF property links with hard file names', () => {
	it('reads angle destinations with parentheses, Unicode, spaces and encoded reserved characters', () => {
		expect(coverTarget('[paper](<PDFs/資料%20(été)%20%26%20notes.pdf#page=2>)')).toEqual({ path: 'PDFs/資料 (été) & notes.pdf', page: 2 });
		expect(coverTarget('[paper](PDFs/Book%20%26%20notes.pdf)')).toEqual({ path: 'PDFs/Book & notes.pdf', page: 1 });
	});
	it('keeps percent escapes literal in wiki links', () => {
		expect(coverTarget('[[PDFs/100%20real.pdf]]')).toEqual({ path: 'PDFs/100%20real.pdf', page: 1 });
	});
	it('rejects nonfinite page dimensions before creating a canvas', () => {
		expect(() => coverBox({ width: Infinity, height: 200 }, 180, 1, 'page')).toThrow();
	});
});
