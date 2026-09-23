import { type LocalImage, loadLocalImage } from '@macro-inc/graphics/browser';
import { createSignal, onCleanup } from 'solid-js';

/** Keep the existing image until a replacement has decoded successfully. */
export function createLocalImageState(
  onLoad: (image: LocalImage) => void,
  loader = loadLocalImage
) {
  const [image, setImage] = createSignal<LocalImage>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let generation = 0;
  onCleanup(() => {
    generation++;
    image()?.dispose();
  });

  async function loadImage(resolve: () => Promise<LocalImage>) {
    const request = ++generation;
    setLoading(true);
    setError(undefined);
    try {
      const next = await resolve();
      if (request !== generation) {
        next.dispose();
        return;
      }
      const previous = image();
      try {
        onLoad(next);
      } catch (error) {
        next.dispose();
        throw error;
      }
      setImage(next);
      previous?.dispose();
    } catch {
      if (request === generation)
        setError(
          'This file could not be opened as an image. Try a PNG, JPEG or WebP.'
        );
    } finally {
      if (request === generation) setLoading(false);
    }
  }
  async function loadDemo() {
    await loadImage(async () => {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}teo.png`;
      await img.decode();
      return {
        src: img.src,
        name: 'teo.png',
        width: img.naturalWidth,
        height: img.naturalHeight,
        dispose() {},
      };
    });
  }
  return {
    image,
    loading,
    error,
    load: (file: File) => loadImage(() => loader(file)),
    loadDemo,
  };
}
