import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { openPdfAt, openPdfButton } from '../src/view';

describe('Open at page button', () => {
	it('opens the PDF file at its page when the file name has a # in it', async () => {
		const app = App.createConfigured__({ files: { 'Books/C# in Depth.pdf': '', 'Books/C.md': '' } });
		const openFile = vi.fn(async () => {});
		const getLeaf = vi.spyOn(app.workspace, 'getLeaf').mockReturnValue({ openFile } as never);
		await openPdfAt(app as never, { path: 'Books/C# in Depth.pdf', page: 2, from: 'self' }, 'tab');
		expect(getLeaf).toHaveBeenCalledWith('tab');
		expect(openFile).toHaveBeenCalledTimes(1);
		const [file, state] = openFile.mock.calls[0] as unknown as [{ path: string }, { eState: { subpath: string } }];
		expect(file.path).toBe('Books/C# in Depth.pdf');
		expect(state.eState.subpath).toBe('#page=2');
	});

	it('does nothing when the PDF is gone', async () => {
		const app = App.createConfigured__({ files: {} });
		const getLeaf = vi.spyOn(app.workspace, 'getLeaf');
		await openPdfAt(app as never, { path: 'Gone.pdf', page: 1, from: 'property' }, false);
		expect(getLeaf).not.toHaveBeenCalled();
	});

	it('opens only the PDF, not the note, when you push Enter on the button', () => {
		const card = document.createElement('div');
		const onCard = vi.fn();
		card.addEventListener('keydown', onCard);
		card.addEventListener('click', onCard);
		const open = vi.fn();
		const button = openPdfButton(card, { path: 'Manual.pdf', page: 3, from: 'property' }, open);
		expect(button.textContent).toBe('Open at page 3');
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onCard).not.toHaveBeenCalled();
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith({ path: 'Manual.pdf', page: 3, from: 'property' }, false);
	});
});

describe('Open at page button keys', () => {
	it('lets keys other than Enter go to the card and to the app hotkeys', () => {
		const card = document.createElement('div');
		const onKey = vi.fn();
		card.addEventListener('keydown', onKey);
		const button = openPdfButton(card, { path: 'Manual.pdf', page: 1, from: 'self' }, vi.fn());
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
		expect(onKey).toHaveBeenCalledTimes(1);
	});
});
