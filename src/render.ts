// Draws PDF pages to JPEG covers with the pdf.js build that ships with Obsidian (loadPdfJs). Covers are kept in a
// memory cache and, with Pro, saved in the plugin folder. At most `parallel` PDFs are open at the same time.
import { loadPdfJs, normalizePath, type App, type TFile } from 'obsidian';
import { LruCache, cacheKey, coverBox, coverFileName, type Crop } from './cover';

/** The few pdf.js calls this plugin makes; loadPdfJs() is typed as any in obsidian.d.ts. */
interface PdfViewport {
	width: number;
	height: number;
}
interface PdfPage {
	getViewport(o: { scale: number }): PdfViewport;
	render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
}
interface PdfDoc {
	numPages: number;
	getPage(n: number): Promise<PdfPage>;
	destroy(): Promise<void>;
}
interface PdfJs {
	getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfDoc> };
}

/** A drawn cover: JPEG bytes, the page that was drawn, the page count and the cover aspect (height / width). */
export interface Cover {
	blob: Blob;
	page: number;
	pages: number;
	aspect: number;
}

export interface CoverRequest {
	file: TFile;
	page: number;
	/** Width in CSS pixels. */
	width: number;
	crop: Crop;
	/** Read and write the saved covers in the plugin folder (Pro). */
	disk: boolean;
}

/** 64 MB of JPEG covers in memory: about 1,000 covers at the default size. */
const MEMORY_BUDGET = 64 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

export class CoverRenderer {
	readonly memory = new LruCache<Cover>(MEMORY_BUDGET);
	private pending = new Map<string, Promise<Cover>>();
	private waiting: (() => void)[] = [];
	private running = 0;
	/** Number of covers drawn with pdf.js (not from a cache); tests read it. */
	drawn = 0;
	/** Number of covers read from the saved covers folder. */
	fromDisk = 0;

	constructor(
		private readonly app: App,
		private readonly folder: string,
		private readonly options: () => { parallel: number; pixelRatio: number },
	) {}

	/** Folder of the saved covers (in the plugin folder, so it is not part of the notes). */
	get diskFolder(): string {
		return normalizePath(`${this.folder}/covers`);
	}

	private key(r: CoverRequest): string {
		return cacheKey(r.file.path, r.file.stat.mtime, r.file.stat.size, r.page, Math.round(r.width * this.ratio()), r.crop);
	}

	private ratio(): number {
		return Math.min(this.options().pixelRatio, Math.max(1, window.devicePixelRatio || 1));
	}

	/** The cover for a request: from memory, then from the saved covers (Pro), else drawn. Same requests share one draw. */
	async cover(r: CoverRequest): Promise<Cover> {
		const key = this.key(r);
		const hit = this.memory.get(key);
		if (hit) return hit;
		const running = this.pending.get(key);
		if (running) return running;
		const job = this.load(r, key).finally(() => this.pending.delete(key));
		this.pending.set(key, job);
		return job;
	}

	private async load(r: CoverRequest, key: string): Promise<Cover> {
		const name = normalizePath(`${this.diskFolder}/${coverFileName(key)}`);
		const meta = `${name}.json`;
		const adapter = this.app.vault.adapter;
		if (r.disk) {
			const saved = await this.readSaved(name, meta);
			if (saved) {
				this.memory.set(key, saved, saved.blob.size);
				this.fromDisk++;
				return saved;
			}
		}
		const cover = await this.slot(() => this.draw(r));
		this.memory.set(key, cover, cover.blob.size);
		if (r.disk) {
			// A failed save (disk full, read-only folder) must not turn a drawn cover into an error on the card.
			try {
				if (!(await adapter.exists(this.diskFolder))) await adapter.mkdir(this.diskFolder);
				await adapter.writeBinary(name, await cover.blob.arrayBuffer());
				await adapter.write(meta, JSON.stringify({ page: cover.page, pages: cover.pages, aspect: cover.aspect }));
			} catch (e) {
				console.warn(`PDF Cover Cards: could not save the cover of ${r.file.path}`, e);
			}
		}
		return cover;
	}

	/** A saved cover, or null when it is missing or its files are damaged (then the caller draws it again). */
	private async readSaved(name: string, meta: string): Promise<Cover | null> {
		const adapter = this.app.vault.adapter;
		try {
			if (!(await adapter.exists(name)) || !(await adapter.exists(meta))) return null;
			const info = JSON.parse(await adapter.read(meta)) as Partial<Record<'page' | 'pages' | 'aspect', unknown>>;
			const { page, pages, aspect } = info;
			if (typeof page !== 'number' || typeof pages !== 'number' || typeof aspect !== 'number' || !(aspect > 0)) return null;
			const blob = new Blob([await adapter.readBinary(name)], { type: 'image/jpeg' });
			return blob.size > 0 ? { blob, page, pages, aspect } : null;
		} catch (e) {
			console.warn(`PDF Cover Cards: could not read the saved cover ${name}`, e);
			return null;
		}
	}

	/** Runs fn when fewer than `parallel` draws are running. */
	private async slot<T>(fn: () => Promise<T>): Promise<T> {
		const max = Math.max(1, Math.min(4, Math.round(this.options().parallel)));
		while (this.running >= max) await new Promise<void>((res) => this.waiting.push(res));
		this.running++;
		try {
			return await fn();
		} finally {
			this.running--;
			this.waiting.shift()?.();
		}
	}

	private async draw(r: CoverRequest): Promise<Cover> {
		const pdfjs = (await loadPdfJs()) as PdfJs;
		const doc = await pdfjs.getDocument({ data: await this.app.vault.readBinary(r.file) }).promise;
		try {
			const pageNo = Math.min(Math.max(1, r.page), doc.numPages);
			const page = await doc.getPage(pageNo);
			const unit = page.getViewport({ scale: 1 });
			const box = coverBox(unit, r.width, this.ratio(), r.crop);
			const viewport = page.getViewport({ scale: box.scale });
			const canvas = createEl('canvas');
			canvas.width = box.width;
			canvas.height = box.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('no 2d canvas');
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, box.width, box.height);
			// The canvas keeps the top of the page when the crop is shorter than the page.
			await page.render({ canvasContext: ctx, viewport }).promise;
			const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', JPEG_QUALITY));
			this.drawn++;
			return { blob, page: pageNo, pages: doc.numPages, aspect: box.height / box.width };
		} finally {
			await doc.destroy();
		}
	}

	/** Deletes the saved covers folder and empties the memory cache. Returns the number of files removed. */
	async clear(): Promise<number> {
		this.memory.clear();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.diskFolder))) return 0;
		const list = await adapter.list(this.diskFolder);
		await adapter.rmdir(this.diskFolder, true);
		return list.files.length;
	}
}
