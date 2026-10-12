import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { PdfCoverView, openPdfButton, type CardState } from '../src/view';

describe('concurrent cover fills', () => {
	it('adds one cover when the observer and fillAll await the same render', async () => {
		const app = App.createConfigured__({ files: { 'Manual.pdf': '' } });
		const coverEl = document.createElement('div');
		const card: CardState = {
			file: app.vault.getFileByPath('Manual.pdf')! as never,
			choice: { path: 'Manual.pdf', page: 1, from: 'self' },
			coverEl, slot: true, status: 'waiting', aspect: 1.414, pages: 0,
		};
		const rendered = { blob: new Blob(['cover']), page: 1, pages: 4, aspect: 1.414 };
		let finish!: (value: typeof rendered) => void;
		const pending = new Promise<typeof rendered>((resolve) => { finish = resolve; });
		const cover = vi.fn(() => pending);
		const opts = { prop: null, useLinks: true, width: 180, showProps: true, crop: 'page' as const };
		const view = Object.assign(Object.create(PdfCoverView.prototype) as PdfCoverView, {
			app, cards: [card], token: 1, urls: [], plugin: { renderer: { cover }, settings: { saveCovers: false } },
			options: () => opts,
		});
		const observerFill = view.fill(card, 1, opts);
		const allFill = view.fillAll();
		expect(cover).toHaveBeenCalledTimes(2);
		finish(rendered);
		await Promise.all([observerFill, allFill]);
		expect(card.status).toBe('drawn');
		expect(coverEl.querySelectorAll('img')).toHaveLength(1);
		expect(coverEl.querySelectorAll('.pdf-cover-card-pages')).toHaveLength(1);
		await view.fill(card, 1, opts);
		expect(cover).toHaveBeenCalledTimes(2);
		URL.revokeObjectURL(coverEl.querySelector('img')!.src);
	});

	it('sets the Open at page button to the drawn page when the link page is past the last page', async () => {
		const app = App.createConfigured__({ files: { 'Manual.pdf': '' } });
		const choice = { path: 'Manual.pdf', page: 99, from: 'property' as const };
		const cardEl = document.createElement('div');
		const coverEl = cardEl.createDiv();
		const open = vi.fn();
		const openEl = openPdfButton(cardEl, choice, open);
		const card: CardState = {
			file: app.vault.getFileByPath('Manual.pdf')! as never,
			choice, coverEl, openEl, slot: true, status: 'waiting', aspect: 1.414, pages: 0,
		};
		// The renderer clamps page 99 to the last page, 4.
		const cover = vi.fn(async () => ({ blob: new Blob(['cover']), page: 4, pages: 4, aspect: 1.414 }));
		const opts = { prop: null, useLinks: true, width: 180, showProps: true, crop: 'page' as const };
		const view = Object.assign(Object.create(PdfCoverView.prototype) as PdfCoverView, {
			app, cards: [card], token: 1, urls: [], plugin: { renderer: { cover }, settings: { saveCovers: false } },
			options: () => opts,
		});
		await view.fill(card, 1, opts);
		expect(openEl.textContent).toBe('Open at page 4');
		openEl.click();
		expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: 'Manual.pdf', page: 4 }), false);
		URL.revokeObjectURL(coverEl.querySelector('img')!.src);
	});
});
