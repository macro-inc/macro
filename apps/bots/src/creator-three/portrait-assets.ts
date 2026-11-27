import {
  Color,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture,
} from 'three';
import { parseScan } from './glb';
import { createHead } from './head';

export type PortraitAssets = {
  head: string;
  color: string;
  normal: string;
  spec: string;
};
export async function loadPortraitAssets(
  assets: PortraitAssets,
  signal: AbortSignal | undefined,
  track: (texture: Texture) => Texture
) {
  async function loadTexture(url: string) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Portrait texture: ${response.status}`);

    const blob = await response.blob();
    signal?.throwIfAborted();

    const source = URL.createObjectURL(blob);
    const image = new Image();
    try {
      image.src = source;
      await image.decode();
      signal?.throwIfAborted();
    } finally {
      URL.revokeObjectURL(source);
    }

    const texture = new Texture(image);
    texture.needsUpdate = true;
    return track(texture);
  }

  async function loadHead() {
    const response = await fetch(assets.head, { signal });
    if (!response.ok) throw new Error(`Head scan: ${response.status}`);

    return createHead(parseScan(await response.arrayBuffer()));
  }

  const [head, color, normal, spec] = await Promise.all([
    loadHead(),
    loadTexture(assets.color),
    loadTexture(assets.normal),
    loadTexture(assets.spec),
  ]);
  color.colorSpace = SRGBColorSpace;
  for (const texture of [color, normal, spec]) {
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 4;
  }
  return [head, color, normal, spec] as const;
}

// Average skin colour of the scan (linear), so a tone can replace it.
export function averageSkinColor(tColor: Texture) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 8;
  const context = probe.getContext('2d', { willReadFrequently: true });
  const image: unknown = tColor.image;
  if (!context || !(image instanceof HTMLImageElement))
    return new Color(0.63, 0.4, 0.31);
  context.drawImage(
    image,
    image.width * 0.4,
    image.height * 0.12,
    image.width * 0.2,
    image.height * 0.1,
    0,
    0,
    8,
    8
  );
  const data = context.getImageData(0, 0, 8, 8).data;
  let r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return new Color().setRGB(r / 16320, g / 16320, b / 16320, SRGBColorSpace);
}
