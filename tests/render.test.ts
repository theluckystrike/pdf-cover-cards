import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { cacheKey } from '../src/cover';
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
	beforeEach(() => { vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(); });
	afterEach(() => { vi.restoreAllMocks(); });

	it('evicts nonempty corrupt saved bytes and shares one replacement draw', async () => {
		const { app, renderer, draw, drawn, request } = setup();
		await renderer.cover(request);
		const jpeg = (await app.vault.adapter.list(renderer.diskFolder)).files.find((f) => f.endsWith('.jpg'))!;
		await app.vault.adapter.writeBinary(jpeg, new TextEncoder().encode('not a JPEG').buffer);
		renderer.memory.clear();
		vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValueOnce(new Error('invalid image'));
		const remove = vi.spyOn(app.vault.adapter, 'remove');
		await expect(Promise.all([renderer.cover(request), renderer.cover(request)])).resolves.toEqual([drawn, drawn]);
		expect(draw).toHaveBeenCalledTimes(2);
		expect(renderer.fromDisk).toBe(0);
		expect(remove).toHaveBeenCalledWith(jpeg);
		expect(remove).toHaveBeenCalledWith(`${jpeg}.json`);
		expect(new TextDecoder().decode(await app.vault.adapter.readBinary(jpeg))).toBe('jpeg');
		await renderer.cover(request);
		expect(draw).toHaveBeenCalledTimes(2);
	});

	it('evicts an unvalidated corrupt memory entry as well as its saved files', async () => {
		const { app, renderer, draw, drawn, request } = setup();
		await renderer.cover(request);
		const file = app.vault.getFileByPath('Manual.pdf')!;
		const key = cacheKey(file.path, file.stat.mtime, file.stat.size, 1, 180, 'page');
		const bad = { ...drawn, blob: new Blob(['corrupt memory JPEG']) };
		renderer.memory.set(key, bad, bad.blob.size);
		vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValueOnce(new Error('bad image'));
		const remove = vi.spyOn(app.vault.adapter, 'remove');
		await expect(renderer.cover(request)).resolves.toBe(drawn);
		expect(renderer.memory.get(key)).toBe(drawn);
		expect(draw).toHaveBeenCalledTimes(2);
		expect(remove).toHaveBeenCalledTimes(2);
		expect(await app.vault.adapter.exists('Manual.pdf')).toBe(true);
	});

	it('removes damaged cache even when the PDF itself can no longer render', async () => {
		const { app, renderer, draw, request } = setup();
		await renderer.cover(request);
		const files = (await app.vault.adapter.list(renderer.diskFolder)).files;
		renderer.memory.clear();
		vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValueOnce(new Error('bad image'));
		draw.mockRejectedValue(new Error('bad PDF'));
		await expect(renderer.cover(request)).rejects.toThrow('bad PDF');
		for (const name of files) expect(await app.vault.adapter.exists(name)).toBe(false);
		expect(renderer.memory.bytes).toBe(0);
		expect(draw).toHaveBeenCalledTimes(2);
		expect(await app.vault.adapter.exists('Manual.pdf')).toBe(true);
	});

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
