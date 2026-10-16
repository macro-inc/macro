import { catchToResult } from '@core/util/result';
import mascot1 from './assets/mascots/001.png';
import mascot2 from './assets/mascots/002.png';
import mascot3 from './assets/mascots/003.png';
import mascot4 from './assets/mascots/004.png';
import mascot5 from './assets/mascots/005.png';
import mascot6 from './assets/mascots/006.png';
import mascot7 from './assets/mascots/007.png';
import mascot8 from './assets/mascots/008.png';

export const MASCOT_IMAGES = [
  mascot1,
  mascot2,
  mascot3,
  mascot4,
  mascot5,
  mascot6,
  mascot7,
  mascot8,
];

export const MASCOT_COLORS = [
  { name: 'Coral', hex: '#ef7063' },
  { name: 'Orange', hex: '#f29b52' },
  { name: 'Gold', hex: '#e3bf4f' },
  { name: 'Green', hex: '#79b96a' },
  { name: 'Teal', hex: '#4eb9ad' },
  { name: 'Blue', hex: '#619ce8' },
  { name: 'Purple', hex: '#a588db' },
  { name: 'Pink', hex: '#e58fb8' },
  { name: 'Black', hex: '#000000' },
  { name: 'White', hex: '#ffffff' },
] as const;

export type MascotColor = (typeof MASCOT_COLORS)[number];

/** Tint the dark sculpted bodies, retaining shading, white eyes and backdrop. */
export function recolorMascotPixels(pixels: Uint8ClampedArray, hex: string) {
  const color = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  for (let i = 0; i < pixels.length; i += 4) {
    const lightness = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    // Fade the tint out before the light background and white facial details.
    const fade = Math.min(1, Math.max(0, (lightness - 96) / 128));
    const tint =
      0.72 * (1 - lightness / 255) * (1 - fade * fade * (3 - 2 * fade));
    // The source eyes are white, well above the body's sculpted highlights.
    const eyeCoverage = Math.max(0, (lightness - 128) / 127);
    for (let channel = 0; channel < 3; channel++) {
      // White needs a light body with soft shadows, rather than a gray tint.
      pixels[i + channel] =
        hex === '#ffffff'
          ? (210 + (pixels[i + channel] * 45) / 255) * (1 - eyeCoverage)
          : pixels[i + channel] + color[channel] * tint;
    }
  }
}

/** The preview and upload share these exact PNG bytes. */
export function renderMascot(source: string, color: MascotColor) {
  return catchToResult(async () => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not render mascot');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    recolorMascotPixels(pixels.data, color.hex);
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Could not export mascot'));
      }, 'image/png');
    });
    return new File([blob], `mascot-${color.name.toLowerCase()}.png`, {
      type: 'image/png',
    });
  });
}
