// Pure logic of PDF Cover Cards: which PDF and page a card shows, how large the cover is drawn, the free cover
// limit, cache keys, the memory cache and the contact sheet layout. No Obsidian import, so vitest runs it as is.

/** Where a card cover comes from: a vault link path and a 1-based page number. */
export interface CoverTarget {
	path: string;
	page: number;
}

/** A resolved cover: the vault path of the PDF, the page, and where the plugin found it. */
export interface CoverChoice extends CoverTarget {
	from: 'self' | 'property' | 'link';
}

export type Crop = 'page' | 'top-half' | 'top-third';

const WIKI = /^!?\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]$/;
const MD = /^!?\[[^\]]*\]\((?:<([^>]+)>|([^\s]+))\)$/;
const PAGE = /(?:^|[#&])page=(\d+)/;

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** Page number from a link subpath such as "#page=3"; 1 when absent or below 1. */
export function pageOf(subpath: string): number {
	const n = Number(PAGE.exec(subpath)?.[1] ?? '1');
	return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Splits a link as written into its path and subpath. Markdown destinations are decoded; others stay literal. */
function parseLink(raw: string): { path: string; hash: string } {
	const text = raw.trim();
	const wiki = WIKI.exec(text);
	const md = wiki ? null : MD.exec(text);
	const destination = md ? (md[1] ?? md[2] ?? '') : text;
	const path = (wiki ? wiki[1] : destination.split('#')[0])?.trim() ?? '';
	const hash = wiki ? (wiki[2] ?? '') : destination.includes('#') ? destination.slice(destination.indexOf('#')) : '';
	// Wiki links and metadata-cache links already contain literal vault paths.
	return { path: md ? safeDecode(path) : path, hash };
}

/**
 * Reads a property value as written in a note ("[[Paper.pdf#page=3]]", "Paper.pdf", "[x](Paper.pdf)")
 * and returns the link path and page. Returns null when the value does not point at a .pdf file.
 */
export function coverTarget(raw: string): CoverTarget | null {
	const { path, hash } = parseLink(raw);
	if (!/\.pdf$/i.test(path)) return null;
	return { path, page: pageOf(hash) };
}

/** File extensions that a card can show as an image cover. */
export const IMAGE_EXTENSIONS = ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'];

/** True when a path ends in one of IMAGE_EXTENSIONS (any case). */
export function isImagePath(path: string): boolean {
	const dot = path.lastIndexOf('.');
	return dot >= 0 && IMAGE_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}

/**
 * The link path of an image link as written, with the same rules as coverTarget and without the subpath. Null for
 * other files and for URLs with a scheme (http:, https:, data: and others): the plugin makes no network requests.
 */
export function imageTarget(raw: string): string | null {
	const { path } = parseLink(raw);
	if (/^[a-z][a-z0-9+.-]*:/i.test(path) || !isImagePath(path)) return null;
	return path;
}

/** What chooseCover needs to know about one base entry. */
export interface CoverInput {
	/** Vault path and extension of the entry file itself. */
	self: { path: string; ext: string };
	/** Values of the chosen PDF property as text, in order (a list property gives several). */
	property: string[];
	/** Links and embeds of the note body as written ("Paper.pdf#page=2"), in note order. */
	links: string[];
	/** Use the first PDF the note links to when the property gives none. */
	useLinks: boolean;
}

/** Maps a link path (without subpath) to the vault path of the file it opens, or null. */
export type Resolve = (linkpath: string) => string | null;

function resolvePdf(t: CoverTarget | null, resolve: Resolve): CoverTarget | null {
	if (!t) return null;
	const path = resolve(t.path);
	return path && /\.pdf$/i.test(path) ? { path, page: t.page } : null;
}

/**
 * The cover of one card. Order: the entry itself when it is a PDF, then the first value of the PDF property that
 * resolves to a PDF, then (when useLinks) the first PDF link or embed of the note. Null when there is none.
 */
export function chooseCover(input: CoverInput, resolve: Resolve): CoverChoice | null {
	if (input.self.ext.toLowerCase() === 'pdf') return { path: input.self.path, page: 1, from: 'self' };
	for (const v of input.property) {
		const t = resolvePdf(coverTarget(v), resolve);
		if (t) return { ...t, from: 'property' };
	}
	if (!input.useLinks) return null;
	for (const l of input.links) {
		const t = resolvePdf(coverTarget(l), resolve);
		if (t) return { ...t, from: 'link' };
	}
	return null;
}

/**
 * The image cover of a card that has no PDF. Call it only when chooseCover gives null. Order: the entry itself when
 * it is an image, then the first value of the PDF property that resolves to an image, then (when useLinks) the
 * first image that the note links to or embeds. Gives the vault path, or null.
 */
export function chooseImage(input: CoverInput, resolve: Resolve): string | null {
	if (isImagePath(`.${input.self.ext}`)) return input.self.path;
	const first = (values: string[]): string | null => {
		for (const v of values) {
			const t = imageTarget(v);
			const path = t ? resolve(t) : null;
			if (path && isImagePath(path)) return path;
		}
		return null;
	};
	return first(input.property) ?? (input.useLinks ? first(input.links) : null);
}

/** What a card shows: a PDF page, an image, or nothing. */
export type CoverKind = 'pdf' | 'image' | null;

/**
 * Status of each card before its cover is drawn. PDF cards use the free cover slots in base order; image cards
 * never use a slot, so they are always drawn.
 */
export function cardStatuses(kinds: CoverKind[], pro: boolean, freeMax: number): ('waiting' | 'locked' | 'empty')[] {
	const slots = coverSlots(kinds.filter((k) => k === 'pdf').length, pro, freeMax);
	let used = 0;
	return kinds.map((k) => (k === 'image' ? 'waiting' : k === 'pdf' ? (used++ < slots ? 'waiting' : 'locked') : 'empty'));
}

/** Bar text: "6 cards, 3 with a PDF", plus ", 2 with an image" when there are image covers. */
export function barText(cards: number, withPdf: number, withImage: number): string {
	const base = `${cards} ${cards === 1 ? 'card' : 'cards'}, ${withPdf} with a PDF`;
	return withImage > 0 ? `${base}, ${withImage} with an image` : base;
}

/** Cover aspect (height / width) of a decoded image after a crop. Throws for a nonfinite or zero size. */
export function imageAspect(width: number, height: number, crop: Crop): number {
	if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('image size must be finite and positive');
	return (height / width) * cropShare(crop);
}

/** Part of the page height that a crop keeps. */
export function cropShare(crop: Crop): number {
	return crop === 'top-half' ? 0.5 : crop === 'top-third' ? 1 / 3 : 1;
}

/** Size of one drawn cover. Canvas pixels are CSS pixels times the pixel ratio. */
export interface CoverBox {
	/** pdf.js render scale (page units to canvas pixels). */
	scale: number;
	/** Canvas size in pixels (after the crop). */
	width: number;
	height: number;
	/** Height of the full page in canvas pixels; the canvas keeps its top part. */
	pageHeight: number;
}

/** Largest canvas side and area, so a poster-size PDF page cannot exhaust memory. */
export const MAX_SIDE = 2048;
export const MAX_AREA = 2048 * 2048;

/**
 * Canvas size for a page of `page.width` x `page.height` units shown `cssWidth` CSS pixels wide.
 * The pixel ratio is clamped to 1..3; the result keeps the page aspect and stays within MAX_SIDE and MAX_AREA.
 */
export function coverBox(page: { width: number; height: number }, cssWidth: number, pixelRatio: number, crop: Crop): CoverBox {
	if (!(page.width > 0 && page.height > 0 && Number.isFinite(page.width) && Number.isFinite(page.height))) throw new Error('page size must be finite and positive');
	if (!(cssWidth > 0)) throw new Error('cssWidth must be positive');
	const ratio = Math.min(3, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1));
	let scale = (cssWidth * ratio) / page.width;
	const share = cropShare(crop);
	const limit = Math.min(MAX_SIDE / page.width, MAX_SIDE / (page.height * share), Math.sqrt(MAX_AREA / (page.width * page.height * share)));
	scale = Math.min(scale, limit);
	const width = Math.max(1, Math.floor(page.width * scale));
	const pageHeight = Math.max(1, Math.floor(page.height * scale));
	return { scale, width, height: Math.max(1, Math.floor(pageHeight * share)), pageHeight };
}

/** Number of cards that get a cover: all with Pro, else the first `freeMax`. */
export function coverSlots(cards: number, pro: boolean, freeMax: number): number {
	if (!Number.isInteger(cards) || cards < 0) throw new Error('cards must be a whole number >= 0');
	return pro ? cards : Math.min(cards, Math.max(0, freeMax));
}

/** Cache key of a drawn cover. The file mtime and size make an edited PDF draw again. */
export function cacheKey(path: string, mtime: number, size: number, page: number, width: number, crop: Crop): string {
	return `${path}|${mtime}|${size}|p${page}|w${width}|${crop}`;
}

/** FNV-1a 32-bit hash as 8 hex digits: the file name of a saved cover. */
export function fnv1a(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

/** File name of a saved cover for a cache key: two hashes, so a clash needs both to match. */
export function coverFileName(key: string): string {
	return `${fnv1a(key)}${fnv1a(`${key.length}:${key}`)}.jpg`;
}

/** Least recently used cache with a byte budget. A value larger than the budget is not kept. */
export class LruCache<V> {
	private map = new Map<string, { value: V; bytes: number }>();
	private used = 0;

	constructor(private readonly budget: number) {
		if (!(budget > 0)) throw new Error('budget must be positive');
	}

	get bytes(): number {
		return this.used;
	}

	get size(): number {
		return this.map.size;
	}

	get(key: string): V | undefined {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		this.map.delete(key);
		this.map.set(key, hit);
		return hit.value;
	}

	set(key: string, value: V, bytes: number): void {
		this.delete(key);
		if (bytes > this.budget) return;
		this.map.set(key, { value, bytes });
		this.used += bytes;
		for (const [k, v] of this.map) {
			if (this.used <= this.budget) break;
			this.map.delete(k);
			this.used -= v.bytes;
		}
	}

	delete(key: string): void {
		const hit = this.map.get(key);
		if (!hit) return;
		this.map.delete(key);
		this.used -= hit.bytes;
	}

	clear(): void {
		this.map.clear();
		this.used = 0;
	}
}

/** One cell of a contact sheet: where its cover goes and where its title line goes. */
export interface SheetCell {
	x: number;
	y: number;
	coverHeight: number;
	titleY: number;
}

export interface SheetLayout {
	width: number;
	height: number;
	cells: SheetCell[];
}

/**
 * Grid for the contact sheet: `columns` cells per row, each `cell` px wide, covers scaled to that width (heights
 * from `aspects`, height/width per cover), one title line of `titleHeight` under each, `gap` px around everything.
 * Every row is as tall as its tallest cover.
 */
export function sheetLayout(aspects: number[], columns: number, cell: number, gap: number, titleHeight: number): SheetLayout {
	if (!(columns >= 1 && cell > 0 && gap >= 0 && titleHeight >= 0)) throw new Error('bad sheet size');
	const cols = Math.min(Math.floor(columns), Math.max(1, aspects.length));
	const cells: SheetCell[] = [];
	let y = gap;
	for (let start = 0; start < aspects.length; start += cols) {
		const row = aspects.slice(start, start + cols).map((a) => Math.round(cell * (a > 0 && Number.isFinite(a) ? a : 1.414)));
		const rowHeight = Math.max(...row);
		row.forEach((h, i) => cells.push({ x: gap + i * (cell + gap), y, coverHeight: h, titleY: y + rowHeight + titleHeight * 0.75 }));
		y += rowHeight + titleHeight + gap;
	}
	return { width: gap + cols * (cell + gap), height: Math.max(y, gap * 2), cells };
}

/**
 * Splits a contact sheet into parts of whole rows, each at most `maxHeight` px tall in sheetLayout, because a
 * canvas that is too tall gives no image. A row taller than the limit gets a part of its own. Gives [start, end)
 * index ranges into `aspects`.
 */
export function sheetParts(aspects: number[], columns: number, cell: number, gap: number, titleHeight: number, maxHeight: number): [number, number][] {
	const cols = Math.min(Math.floor(columns), Math.max(1, aspects.length));
	const parts: [number, number][] = [];
	let start = 0;
	let y = gap;
	for (let row = 0; row < aspects.length; row += cols) {
		const add = sheetLayout(aspects.slice(row, row + cols), cols, cell, gap, titleHeight).height - gap;
		if (row > start && y + add > maxHeight) {
			parts.push([start, row]);
			start = row;
			y = gap;
		}
		y += add;
	}
	if (aspects.length > start) parts.push([start, aspects.length]);
	return parts;
}

/** "1 page" or "12 pages". */
export function pagesLabel(n: number): string {
	return `${n} ${n === 1 ? 'page' : 'pages'}`;
}

/** The fields of a wheel event that wheelPixels reads. */
export interface WheelInput {
	deltaX: number;
	deltaY: number;
	/** 0 pixels, 1 lines, 2 pages (WheelEvent.deltaMode). */
	deltaMode: number;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}

/** Pixels for one line and one page of a wheel event in line or page mode. */
export const WHEEL_LINE = 40;
export const WHEEL_PAGE = 800;
/** Wheel pixels for one page turn. */
export const WHEEL_STEP = 60;

/**
 * The part of a wheel event that turns pages, in pixels. Positive is the next page. A horizontal scroll counts
 * (right is next), and Shift with the vertical wheel counts (down is next). A plain vertical scroll gives 0, so the
 * base keeps its normal scroll. Ctrl, Cmd and Alt give 0: they are zoom and other app gestures.
 */
export function wheelPixels(e: WheelInput): number {
	if (e.ctrlKey || e.metaKey || e.altKey) return 0;
	const x = Number.isFinite(e.deltaX) ? e.deltaX : 0;
	const y = Number.isFinite(e.deltaY) ? e.deltaY : 0;
	let d = 0;
	if (e.shiftKey) d = y !== 0 ? y : x;
	else if (Math.abs(x) > Math.abs(y)) d = x;
	const unit = e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? WHEEL_PAGE : 1;
	return d * unit;
}

/**
 * Adds wheel pixels to the running sum and returns the page step (-1, 0 or 1) and the new sum. At most one page for
 * each event. The sum starts again when the direction changes and after a step.
 */
export function wheelTurn(carry: number, pixels: number, threshold = WHEEL_STEP): { step: number; carry: number } {
	if (!Number.isFinite(pixels) || pixels === 0) return { step: 0, carry: Number.isFinite(carry) ? carry : 0 };
	const base = Number.isFinite(carry) && Math.sign(carry) === Math.sign(pixels) ? carry : 0;
	const sum = base + pixels;
	if (Math.abs(sum) >= threshold) return { step: Math.sign(sum), carry: 0 };
	return { step: 0, carry: sum };
}

/** A wheel gesture ends after this many milliseconds without a wheel event (the inertia tail is part of it). */
export const WHEEL_GESTURE_MS = 250;
/** Movement in pixels that sets the axis of a new gesture. */
export const WHEEL_DECIDE_PX = 15;

/** The state of the current wheel gesture over the cards. */
export interface WheelGesture {
	/** Time of the last wheel event. */
	at: number;
	/** null until the gesture moves WHEEL_DECIDE_PX; then "turn" (sideways or Shift) or "scroll". */
	axis: 'turn' | 'scroll' | null;
	/** Sideways and vertical movement before the axis is set. */
	sx: number;
	sy: number;
	/** Page pixels since the gesture start or the last turn, in one direction. */
	carry: number;
	/** Direction of the turn of this gesture (1 or -1), or 0 before a turn. */
	done: number;
	/** Page pixels of the current run of clearly sideways events in a scroll gesture. */
	run: number;
}

/**
 * One wheel event of a gesture. Returns the new gesture state, the page pixels of the event (0: the event is not a
 * page turn event, keep its default scroll) and the page step (-1, 0 or 1).
 * - An event is clearly sideways when |x| > 2|y|, or when Shift is held. Other events (vertical) are never used.
 * - The axis is set when the gesture has moved WHEEL_DECIDE_PX: "turn" when the movement is clearly sideways.
 *   In a scroll gesture, a run of clearly sideways events of WHEEL_DECIDE_PX starts a new turn gesture.
 * - Pixel mode: one page for each gesture. After a turn, events of the same direction (the inertia tail) do not turn
 *   pages until WHEEL_GESTURE_MS pass with no wheel event. This is also true for a mouse wheel in pixel mode: a
 *   continuous spin is one gesture. (Chromium merges events during a main thread stall, so size and gaps of events
 *   cannot tell notches from inertia.)
 * - Line and page mode (wheel notches): one page for each event.
 */
export function wheelGesture(state: WheelGesture | null, e: WheelInput, t: number): { state: WheelGesture; pixels: number; step: number } {
	const time = Number.isFinite(t) ? t : 0;
	const gap = state ? time - state.at : Infinity;
	const fresh = state !== null && gap >= 0 && gap <= WHEEL_GESTURE_MS;
	let s: WheelGesture = fresh ? { ...state, at: time } : { at: time, axis: null, sx: 0, sy: 0, carry: 0, done: 0, run: 0 };
	const none = (): { state: WheelGesture; pixels: number; step: number } => ({ state: s, pixels: 0, step: 0 });
	if (e.ctrlKey || e.metaKey || e.altKey) return none();
	const unit = e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? WHEEL_PAGE : 1;
	const x = (Number.isFinite(e.deltaX) ? e.deltaX : 0) * unit;
	const y = (Number.isFinite(e.deltaY) ? e.deltaY : 0) * unit;
	const px = e.shiftKey ? (y !== 0 ? y : x) : x;
	const sideways = px !== 0 && (e.shiftKey || Math.abs(x) > 2 * Math.abs(y));
	if (s.axis === null) {
		s = { ...s, sx: s.sx + (e.shiftKey ? Math.abs(px) : Math.abs(x)), sy: s.sy + (e.shiftKey ? 0 : Math.abs(y)), carry: s.carry + (sideways ? px : 0) };
		if (e.shiftKey) s.axis = 'turn';
		else if (s.sx + s.sy >= WHEEL_DECIDE_PX) s.axis = s.sx > 2 * s.sy ? 'turn' : 'scroll';
		if (s.axis !== 'turn' || !sideways) return none();
		// The pixels of this event are in carry already.
		s.carry -= px;
	} else if (s.axis === 'scroll') {
		if (!sideways) {
			s.run = 0;
			return none();
		}
		s.run = Math.sign(s.run) === Math.sign(px) ? s.run + px : px;
		if (Math.abs(s.run) < WHEEL_DECIDE_PX) return none();
		// The axis changed clearly: a new turn gesture starts with this run.
		s = { ...s, axis: 'turn', carry: s.run - px, done: 0, run: 0 };
	} else if (!sideways) return none();
	const dir = Math.sign(px);
	if (e.deltaMode === 1 || e.deltaMode === 2) return { state: { ...s, carry: 0, done: dir }, pixels: px, step: dir };
	if (s.done === dir) return { state: s, pixels: px, step: 0 };
	const r = wheelTurn(s.carry, px);
	return r.step !== 0 ? { state: { ...s, carry: 0, done: r.step }, pixels: px, step: r.step } : { state: { ...s, carry: r.carry }, pixels: px, step: 0 };
}

/** The page after a step, kept between 1 and the page count. Returns 1 for a bad page or page count. */
export function turnTarget(page: number, step: number, pages: number): number {
	const last = Number.isInteger(pages) && pages >= 1 ? pages : 1;
	const from = Number.isInteger(page) ? page : 1;
	const to = from + (Number.isInteger(step) ? step : 0);
	return Math.min(last, Math.max(1, to));
}
