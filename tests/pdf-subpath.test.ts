import { describe, expect, it } from 'vitest';
import { pdfSubpath } from '../src/view';

describe('pdfSubpath', () => {
	it('gives the subpath with the page of the choice', () => {
		expect(pdfSubpath({ path: 'Papers/Attention.pdf', page: 3, from: 'self' })).toBe('#page=3');
	});

	it('gives page 1 when the choice has no page subpath', () => {
		expect(pdfSubpath({ path: 'Scans/Book scan.pdf', page: 1, from: 'property' })).toBe('#page=1');
	});
});
