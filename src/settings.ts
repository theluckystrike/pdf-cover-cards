import { Notice, PluginSettingTab, type Setting, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { FREE_MAX_COVERS, PRO_UI, isPro } from './pro';
import type PdfCoverCardsPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface PdfCoverCardsSettings {
	/** Largest pixel ratio of a drawn cover: 1 is fast, 2 is sharp on high-density screens. */
	pixelRatio: number;
	/** Number of PDFs drawn at the same time. */
	parallel: number;
	/** Pro: save drawn covers in the plugin folder, so a base opens fast the next time. */
	saveCovers: boolean;
}

export const DEFAULT_SETTINGS: PdfCoverCardsSettings = {
	pixelRatio: 2,
	parallel: 2,
	saveCovers: true,
};

function clamp(v: unknown, min: number, max: number, def: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<PdfCoverCardsSettings> | null | undefined): PdfCoverCardsSettings {
	const s = saved ?? {};
	return {
		pixelRatio: clamp(s.pixelRatio, 1, 3, DEFAULT_SETTINGS.pixelRatio),
		parallel: Math.round(clamp(s.parallel, 1, 4, DEFAULT_SETTINGS.parallel)),
		saveCovers: typeof s.saveCovers === 'boolean' ? s.saveCovers : DEFAULT_SETTINGS.saveCovers,
	};
}

export class PdfCoverCardsSettingTab extends PluginSettingTab {
	plugin: PdfCoverCardsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: PdfCoverCardsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Cover sharpness',
				desc: 'Largest pixel ratio of a drawn cover. 1 draws fastest. 2 is sharp on high-density screens. Covers already drawn stay as they are until the PDF changes or you clear the saved covers.',
				control: { type: 'slider', key: 'pixelRatio', defaultValue: DEFAULT_SETTINGS.pixelRatio, min: 1, max: 3, step: 0.5 },
			},
			{
				name: 'PDFs drawn at the same time',
				desc: 'From 1 to 4. Use 1 on a phone or with very large PDFs.',
				control: { type: 'slider', key: 'parallel', defaultValue: DEFAULT_SETTINGS.parallel, min: 1, max: 4, step: 1 },
			},
			{
				name: 'Save drawn covers (Pro)',
				desc: 'Keeps each drawn cover as a small JPEG file in the plugin folder, so a large base shows its covers at once the next time. The files are not notes and are not indexed.',
				control: { type: 'toggle', key: 'saveCovers', defaultValue: DEFAULT_SETTINGS.saveCovers },
			},
			{
				name: 'Clear saved covers',
				desc: 'Deletes the saved cover files and the covers in memory. Open views draw their covers again.',
				render: (setting: Setting) => {
					setting.addButton((b) =>
						b.setButtonText('Clear').onClick(async () => {
							const n = await this.plugin.renderer.clear();
							new Notice(`Deleted ${n} saved cover ${n === 1 ? 'file' : 'files'}.`);
							this.plugin.redrawAll();
						}),
					);
				},
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: covers on every card, cover crop, saved covers and the contact sheet export.'
					: `Free version: covers on the first ${FREE_MAX_COVERS} cards of a view, page choice with #page=N, properties on the cards. ${PRO_UI.proSummary}`,
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
