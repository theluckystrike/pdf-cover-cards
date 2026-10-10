// Writes the sample PDFs of the test vault: made-up books, papers and manuals with drawn covers.
// Plain PDF 1.4 with the standard Helvetica and Times fonts, so no font files and no dependency.
// Run: node test/e2e/make-pdfs.mjs   (from products/pdf-cover-cards). Output is deterministic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, 'vault', 'Library', 'PDFs');

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const rgb = (hex) => [0, 2, 4].map((i) => (parseInt(hex.slice(i + 1, i + 3), 16) / 255).toFixed(3)).join(' ');

/** Splits text into lines of at most `max` characters, on spaces. */
function wrap(text, max) {
	const lines = [];
	let line = '';
	for (const w of text.split(' ')) {
		if (line && (line + ' ' + w).length > max) {
			lines.push(line);
			line = w;
		} else line = line ? `${line} ${w}` : w;
	}
	if (line) lines.push(line);
	return lines;
}

function text(font, size, x, y, s, color = '#000000') {
	return `BT ${rgb(color)} rg /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET\n`;
}

function rect(x, y, w, h, color) {
	return `${rgb(color)} rg ${x} ${y} ${w} ${h} re f\n`;
}

/** Book cover: colored page, a band, the title, the author and a simple pattern. */
function bookCover(b, W, H) {
	let s = rect(0, 0, W, H, b.bg);
	s += rect(0, H * 0.58, W, H * 0.3, b.band);
	for (let i = 0; i < 6; i++) s += rect(36 + i * 22, 70, 12, 12 + i * 9, b.accent);
	let y = H * 0.8;
	for (const line of wrap(b.title, 16)) {
		s += text('F2', 30, 36, y, line, b.ink);
		y -= 36;
	}
	s += text('F1', 14, 36, H * 0.5, b.author, b.ink);
	s += text('F1', 10, 36, 40, b.kind.toUpperCase(), b.ink);
	return s;
}

/** Paper first page: white, title, authors, abstract and two columns of gray text bars. */
function paperCover(b, W, H) {
	let s = rect(0, 0, W, H, '#ffffff');
	let y = H - 80;
	for (const line of wrap(b.title, 40)) {
		s += text('F2', 20, 60, y, line, '#111111');
		y -= 26;
	}
	s += text('F3', 12, 60, y - 6, b.author, '#333333');
	y -= 40;
	s += text('F2', 11, 60, y, 'Abstract', '#111111');
	y -= 16;
	for (let i = 0; i < 6; i++, y -= 12) s += rect(60, y, W - 120 - (i === 5 ? 160 : 0), 6, '#9a9a9a');
	y -= 20;
	for (let col = 0; col < 2; col++) {
		let cy = y;
		for (let i = 0; i < 34 && cy > 60; i++, cy -= 12) s += rect(60 + col * ((W - 120) / 2 + 10), cy, (W - 120) / 2 - 10 - (i % 7 === 6 ? 60 : 0), 6, '#b5b5b5');
	}
	s += rect(60, H - 40, W - 120, 3, b.bg);
	return s;
}

function contentsPage(b, W, H) {
	let s = text('F2', 22, 50, H - 80, 'Contents');
	b.chapters.forEach((c, i) => (s += text('F3', 13, 50, H - 120 - i * 22, `${i + 1}. ${c}`)));
	return s;
}

function chapterPage(b, W, H, n) {
	let s = text('F2', 20, 50, H - 80, `${n}. ${b.chapters[n - 1] ?? 'Notes'}`);
	for (let i = 0; i < 24; i++) s += rect(50, H - 120 - i * 16, W - 100 - (i % 6 === 5 ? 120 : 0), 6, '#c4c4c4');
	return s;
}

/** Builds one PDF file with the given page content streams. */
function pdf(pages, W, H) {
	const objs = [];
	const add = (body) => objs.push(body) && objs.length;
	const catalog = add('');
	const pagesObj = add('');
	const fonts = [add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'), add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'), add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>')];
	const kids = [];
	for (const content of pages) {
		const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
		kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >> /Contents ${c} 0 R >>`));
	}
	objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
	objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
	let out = '%PDF-1.4\n';
	const offsets = [];
	objs.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out, 'latin1'));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out, 'latin1');
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

export const BOOKS = [
	{ file: 'Field Guide to Mosses', title: 'Field Guide to Mosses', author: 'Ada Brenner', kind: 'book', bg: '#2f5d50', band: '#3f7a68', accent: '#a8d5ba', ink: '#ffffff' },
	{ file: 'Rivers of the North', title: 'Rivers of the North', author: 'Tomas Lind', kind: 'book', bg: '#1d3557', band: '#457b9d', accent: '#a8dadc', ink: '#ffffff' },
	{ file: 'The Quiet Workshop', title: 'The Quiet Workshop', author: 'Mira Okafor', kind: 'book', bg: '#e9c46a', band: '#f4a261', accent: '#264653', ink: '#264653' },
	{ file: 'Small Engines Repair Manual', title: 'Small Engines Repair Manual', author: 'Northfield Tools', kind: 'manual', bg: '#d62828', band: '#f77f00', accent: '#fcbf49', ink: '#ffffff' },
	{ file: 'A History of Paper Maps', title: 'A History of Paper Maps', author: 'Lena Varga', kind: 'book', bg: '#6d597a', band: '#b56576', accent: '#eaac8b', ink: '#ffffff' },
	{ file: 'Bread at Home', title: 'Bread at Home', author: 'Jonah Pell', kind: 'book', bg: '#bc6c25', band: '#dda15e', accent: '#fefae0', ink: '#fefae0' },
	{ file: 'Sparse Attention in Practice', title: 'Sparse Attention in Practice: A Field Study', author: 'R. Iyer, K. Holm and P. Ade', kind: 'paper', bg: '#1d3557' },
	{ file: 'Soil Carbon Survey 2025', title: 'Soil Carbon Survey 2025: Methods and First Results', author: 'Northern Soils Group', kind: 'paper', bg: '#2f5d50' },
	{ file: 'Night Trains', title: 'Night Trains', author: 'Ivo Marek', kind: 'book', bg: '#0b132b', band: '#1c2541', accent: '#5bc0be', ink: '#ffffff' },
	{ file: 'Garden Planner 2026', title: 'Garden Planner 2026', author: 'Green Row Press', kind: 'manual', bg: '#606c38', band: '#283618', accent: '#fefae0', ink: '#fefae0' },
	{ file: 'Letters from the Coast', title: 'Letters from the Coast', author: 'Sara Ilves', kind: 'book', bg: '#3a86ff', band: '#8338ec', accent: '#ffbe0b', ink: '#ffffff' },
	{ file: 'Camera Basics', title: 'Camera Basics', author: 'Lumen School', kind: 'manual', bg: '#212529', band: '#495057', accent: '#ffd166', ink: '#ffd166' },
];

const CHAPTERS = ['Before you start', 'First steps', 'Going further', 'Notes and sources'];

if (process.argv[1] === import.meta.filename) {
	mkdirSync(OUT, { recursive: true });
	for (const b of BOOKS) {
		const paper = b.kind === 'paper';
		const [W, H] = paper ? [595, 842] : [420, 595];
		const book = { ...b, chapters: CHAPTERS };
		const pages = [paper ? paperCover(book, W, H) : bookCover(book, W, H), contentsPage(book, W, H), chapterPage(book, W, H, 1), chapterPage(book, W, H, 2)];
		writeFileSync(join(OUT, `${b.file}.pdf`), pdf(pages, W, H));
	}
	console.log(`wrote ${BOOKS.length} PDFs to ${OUT}`);
}
