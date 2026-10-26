import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PdfCoverCardsPlugin from '../src/main';
import { VIEW_ID, viewOptions } from '../src/view';
import { FREE_MAX_COVERS, PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
		listeners: () => fns.size,
	};
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new PdfCoverCardsPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings and clamps the numbers', () => {
		expect(normalizeSettings({ pixelRatio: 'x' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ pixelRatio: 0.2 }).pixelRatio).toBe(1);
		expect(normalizeSettings({ pixelRatio: 9 }).pixelRatio).toBe(3);
		expect(normalizeSettings({ parallel: 2.6 }).parallel).toBe(3);
		expect(normalizeSettings({ parallel: 99 }).parallel).toBe(4);
		expect(normalizeSettings({ saveCovers: 'yes' as never }).saveCovers).toBe(true);
		expect(normalizeSettings({ saveCovers: false }).saveCovers).toBe(false);
	});
});

describe('view registration', () => {
	it('has the view id and the options in menu order', () => {
		expect(VIEW_ID).toBe('pdf-cover-cards');
		const opts = viewOptions();
		expect(opts.map((o) => ('key' in o ? o.key : o.displayName))).toEqual(['pdfProperty', 'useLinks', 'showImages', 'cardWidth', 'showProps', 'wheelPages', 'Pro']);
	});
});

describe('pro facade', () => {
	it('is off with no manager', () => {
		expect(isPro()).toBe(false);
	});

	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		m.set(false);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(isPro()).toBe(false);
	});

	it('reset unbinds the manager', () => {
		const m = fakeManager(true);
		bindPro(m as never);
		expect(m.listeners()).toBe(1);
		resetPro();
		expect(m.listeners()).toBe(0);
		expect(isPro()).toBe(false);
	});

	it('the free cover limit is 30 and the sponsor terms match product.yaml', () => {
		expect(FREE_MAX_COVERS).toBe(30);
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});
