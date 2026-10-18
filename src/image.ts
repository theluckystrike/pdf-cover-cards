/** Decodes an image before it is used. The caller owns the returned object URL. */
export async function coverImage(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
	const url = URL.createObjectURL(blob);
	const image = createEl('img');
	let timer: number | undefined;
	try {
		image.src = url;
		await Promise.race([
			image.decode(),
			new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('Cover image timed out')), 15000); }),
		]);
		return { image, url };
	} catch (e) {
		URL.revokeObjectURL(url);
		throw e;
	} finally {
		window.clearTimeout(timer);
	}
}
