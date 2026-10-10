import { describe, expect, it } from 'vitest';
import vectors from './vectors/pdf-cover-cards.json';
import { coverTarget } from '../src/cover';

describe('golden vectors (packages/spec/vectors/pdf-cover-cards.json)', () => {
	it('has at least 15 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(15);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [raw] = c.args as [string];
			expect(coverTarget(raw)).toEqual(c.expected);
		});
	}
});
