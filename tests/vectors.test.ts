import { describe, expect, it } from 'vitest';
import vectors from './vectors/pdf-cover-cards.json';
import { chooseImage, coverTarget, turnTarget, wheelPixels, wheelTurn, type CoverInput, type WheelInput } from '../src/cover';

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

describe('golden image vectors (imageCases, chooseImage)', () => {
	it('has at least 10 cases', () => {
		expect(vectors.imageCases.length).toBeGreaterThanOrEqual(10);
	});
	for (const c of vectors.imageCases) {
		it(c.name, () => {
			const [input, paths] = c.args as [CoverInput, string[]];
			const resolve = (link: string): string | null => {
				if (paths.includes(link)) return link;
				const hits = paths.filter((p) => p.endsWith(`/${link}`));
				return hits.length === 1 ? hits[0]! : null;
			};
			expect(chooseImage(input, resolve)).toEqual(c.expected);
		});
	}
});

describe('golden wheel vectors (wheelCases)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.wheelCases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.wheelCases) {
		it(c.name, () => {
			const args = c.args as unknown[];
			if (c.fn === 'wheelPixels') expect(wheelPixels(args[0] as WheelInput)).toBe(c.expected);
			else if (c.fn === 'wheelTurn') expect(wheelTurn(args[0] as number, args[1] as number)).toEqual(c.expected);
			else if (c.fn === 'turnTarget') expect(turnTarget(args[0] as number, args[1] as number, args[2] as number)).toBe(c.expected);
			else throw new Error(`unknown fn ${c.fn}`);
		});
	}
});
