export type LocalImage = {
  src: string;
  name: string;
  width: number;
  height: number;
  dispose(): void;
};

/** Decode a local file without uploading it. The caller owns the returned URL. */
export async function loadLocalImage(file: File): Promise<LocalImage> {
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('Image has no dimensions');
    return {
      src,
      name: file.name,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(src),
    };
  } catch (error) {
    URL.revokeObjectURL(src);
    throw error;
  }
}
