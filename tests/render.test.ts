import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { CoverRenderer, type Cover } from '../src/render';

function setup() {
	const app = App.createConfigured__({ files: { 'Manual.pdf': '' } });
	const renderer = new CoverRenderer(app as never, '.obsidian/plugins/pdf-cover-cards', () => ({ parallel: 2, pixelRatio: 1 }));
	const drawn: Cover = { blob: new Blob(['jpeg']), page: 1, pages: 4, aspect: 1.414 };
	const draw = vi.spyOn(renderer as unknown as { draw: () => Promise<Cover> }, 'draw').mockResolvedValue(drawn);
	const file = app.vault.getFileByPath('Manual.pdf')!;
	const request = { file: file as never, page: 1, width: 180, crop: 'page' as const, disk: true };
	return { app, renderer, draw, drawn, request };
}

describe('saved covers', () => {
	it('keeps the drawn cover when the saved cover file cannot be written', async () => {
		const { app, renderer, drawn, request } = setup();
		vi.spyOn(app.vault.adapter, 'writeBinary').mockRejectedValue(new Error('disk full'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await expect(renderer.cover(request)).resolves.toBe(drawn);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('draws the cover again when the saved cover data is damaged', async () => {
		const { app, renderer, draw, drawn, request } = setup();
		await renderer.cover(request);
		expect(draw).toHaveBeenCalledTimes(1);
		const folder = renderer.diskFolder;
		const meta = (await app.vault.adapter.list(folder)).files.find((f) => f.endsWith('.json'))!;
		await app.vault.adapter.write(meta, '{"page":1,');
		renderer.memory.clear();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await expect(renderer.cover(request)).resolves.toBe(drawn);
		expect(draw).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it('reads a good saved cover without drawing', async () => {
		const { renderer, draw, request } = setup();
		await renderer.cover(request);
		renderer.memory.clear();
		const cover = await renderer.cover(request);
		expect(draw).toHaveBeenCalledTimes(1);
		expect(renderer.fromDisk).toBe(1);
		expect(cover).toMatchObject({ page: 1, pages: 4, aspect: 1.414 });
	});
});
