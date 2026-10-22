import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { PdfCoverView, openPdfButton, type CardState } from '../src/view';

describe('concurrent cover fills', () => {
	beforeEach(() => { vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(); });
	afterEach(() => { vi.restoreAllMocks(); });

	it('browses pages without opening the card and keeps the free slot limit', async () => {
		const app = App.createConfigured__({ files: { 'Manual.pdf': '' } });
		const cardEl = document.createElement('div');
		const choice = { path: 'Manual.pdf', page: 1, from: 'self' as const };
		const open = vi.fn();
		cardEl.addEventListener('click', open);
		cardEl.addEventListener('keydown', open);
		const card: CardState = { file: app.vault.getFileByPath('Manual.pdf')! as never, choice,
			image: null, coverEl: cardEl.createDiv(), openEl: openPdfButton(cardEl, choice, vi.fn()), slot: true, status: 'waiting', aspect: 1, pages: 0 };
		const cover = vi.fn(async (r: { page: number }) => ({ blob: new Blob(['cover']), page: r.page, pages: 2, aspect: 1 }));
		const opts = { prop: null, useLinks: true, width: 180, showProps: true, crop: 'page' as const };
		const view = Object.assign(Object.create(PdfCoverView.prototype) as PdfCoverView, {
			app, cards: [card], token: 1, urls: [], plugin: { renderer: { cover }, settings: { saveCovers: false } }, options: () => opts });
		await view.fill(card, 1, opts);
		expect(card.pageControls?.querySelector('button')?.disabled).toBe(true);
		const next = card.pageControls!.querySelectorAll('button')[1]!;
		next.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		next.click();
		await vi.waitFor(() => expect(card.status).toBe('drawn'));
		expect(card.choice?.page).toBe(2);
		expect(card.openEl?.textContent).toBe('Open at page 2');
		expect(card.coverEl.querySelectorAll('img')).toHaveLength(1);
		expect(card.pageControls?.querySelectorAll('button')[1]?.disabled).toBe(true);
		expect(open).not.toHaveBeenCalled();
		await view.changePage(card, 1);
		expect(cover).toHaveBeenCalledTimes(2);
		await view.changePage(card, -1);
		expect(card.choice?.page).toBe(1);
		card.slot = false;
		await view.changePage(card, 1);
		expect(cover).toHaveBeenCalledTimes(3);
		URL.revokeObjectURL(card.coverEl.querySelector('img')!.src);
	});

	it('waits for the image and reports a final decode failure without retrying forever', async () => {
		const app = App.createConfigured__({ files: { 'Manual.pdf': '' } });
		const card: CardState = { file: app.vault.getFileByPath('Manual.pdf')! as never,
			choice: { path: 'Manual.pdf', page: 1, from: 'self' }, image: null, coverEl: document.createElement('div'),
			slot: true, status: 'waiting', aspect: 1.414, pages: 0 };
		let reject!: (e: Error) => void;
		vi.mocked(HTMLImageElement.prototype.decode).mockReturnValue(new Promise<void>((_, no) => { reject = no; }));
		const cover = vi.fn(async () => ({ blob: new Blob(['bad']), page: 1, pages: 1, aspect: 1 }));
		const opts = { prop: null, useLinks: true, width: 180, showProps: true, crop: 'page' as const };
		const view = Object.assign(Object.create(PdfCoverView.prototype) as PdfCoverView, {
			app, cards: [card], token: 1, urls: [], plugin: { renderer: { cover }, settings: { saveCovers: false } }, options: () => opts });
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const filling = view.fill(card, 1, opts);
		await vi.waitFor(() => expect(HTMLImageElement.prototype.decode).toHaveBeenCalled());
		expect(card.status).toBe('waiting');
		reject(new Error('bad JPEG'));
		await filling;
		expect(card.status).toBe('error');
		expect(card.coverEl.textContent).toContain('This PDF could not be read');
		expect(card.coverEl.querySelectorAll('img')).toHaveLength(0);
		expect(revoke).toHaveBeenCalledTimes(1);
		await view.fill(card, 1, opts);
		expect(cover).toHaveBeenCalledTimes(1);
	});

	it('adds one cover when the observer and fillAll await the same render', async () => {
		const app = App.createConfigured__({ files: { 'Manual.pdf': '' } });
		const coverEl = document.createElement('div');
		const card: CardState = {
			file: app.vault.getFileByPath('Manual.pdf')! as never,
			choice: { path: 'Manual.pdf', page: 1, from: 'self' },
			image: null, coverEl, slot: true, status: 'waiting', aspect: 1.414, pages: 0,
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
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const observerFill = view.fill(card, 1, opts);
		const allFill = view.fillAll();
		expect(cover).toHaveBeenCalledTimes(2);
		finish(rendered);
		await Promise.all([observerFill, allFill]);
		expect(card.status).toBe('drawn');
		expect(coverEl.querySelectorAll('img')).toHaveLength(1);
		expect(revoke).toHaveBeenCalledTimes(1);
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
			choice, image: null, coverEl, openEl, slot: true, status: 'waiting', aspect: 1.414, pages: 0,
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
