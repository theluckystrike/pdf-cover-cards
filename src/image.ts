/** Waits until an image with a src has decoded. Rejects on a decode error or after 15 seconds. */
export async function decodeImage(image: HTMLImageElement): Promise<void> {
	let timer: number | undefined;
	try {
		await Promise.race([
			image.decode(),
			new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('Cover image timed out')), 15000); }),
		]);
	} finally {
		window.clearTimeout(timer);
	}
}

/** Decodes an image before it is used. The caller owns the returned object URL. */
export async function coverImage(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
	const url = URL.createObjectURL(blob);
	const image = createEl('img');
	try {
		image.src = url;
		await decodeImage(image);
		return { image, url };
	} catch (e) {
		URL.revokeObjectURL(url);
		throw e;
	}
}
