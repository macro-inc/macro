import { createSignal } from 'solid-js';
import * as THREE from 'three';
import { themeReactive } from '../../../block-theme/signals/themeReactive';

export const [colorContrast, setColorContrast] = createSignal<THREE.Color>();
export const [colorAccent, setColorAccent] = createSignal<THREE.Color>();
export const [colorBase, setColorBase] = createSignal<THREE.Color>();
export const rafSpeed = navigator.vendor?.includes('Apple') ? 2 : 1;
export const [currentTheme, setCurrentTheme] = createSignal();
export const [pixelation, setPixelation] = createSignal(1);
export const [speed, setSpeed] = createSignal(1);

export interface ThemeColor {
  contrast: [number, number, number];
  surface: [number, number, number];
  accent: [number, number, number];
}

export interface ThemeValues {
  '--accent-l': number;
  '--accent-c': number;
  '--accent-h': number;
  '--contrast-l': number;
  '--contrast-c': number;
  '--contrast-h': number;
  '--surface-l': number;
  '--surface-c': number;
  '--surface-h': number;
}

export function setColor() {
  const currentTheme = getCurrentTheme();
  setColorContrast(
    new THREE.Color().setRGB(
      currentTheme.contrast[0],
      currentTheme.contrast[1],
      currentTheme.contrast[2],
      THREE.SRGBColorSpace
    )
  );
  setColorBase(
    new THREE.Color().setRGB(
      currentTheme.surface[0],
      currentTheme.surface[1],
      currentTheme.surface[2],
      THREE.SRGBColorSpace
    )
  );
  setColorAccent(
    new THREE.Color().setRGB(
      currentTheme.accent[0],
      currentTheme.accent[1],
      currentTheme.accent[2],
      THREE.SRGBColorSpace
    )
  );
}

export function oklchToRgb(
  lightness: number,
  chroma: number,
  hueInDegrees: number
): [number, number, number] {
  const hueInRadians = (hueInDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hueInRadians);
  const b = chroma * Math.sin(hueInRadians);

  const okLabLCubed = Math.pow(
    lightness + a * 0.3963377774 + b * 0.2158037573,
    3
  );
  const okLabMCubed = Math.pow(
    lightness - a * 0.1055613458 - b * 0.0638541728,
    3
  );
  const okLabSCubed = Math.pow(
    lightness - a * 0.0894841775 - b * 1.291485548,
    3
  );

  function gammaCorrection(linearComponent: number): number {
    return linearComponent <= 0.0031308
      ? 12.92 * linearComponent
      : 1.055 * Math.pow(linearComponent, 1 / 2.4) - 0.055;
  }

  return [
    gammaCorrection(
      okLabLCubed * 4.0767416621 -
        okLabMCubed * 3.3077115913 +
        okLabSCubed * 0.2309699292
    ),
    gammaCorrection(
      okLabLCubed * -1.2684380046 +
        okLabMCubed * 2.6097574011 -
        okLabSCubed * 0.3413193965
    ),
    gammaCorrection(
      okLabLCubed * -0.0041960863 -
        okLabMCubed * 0.7034186147 +
        okLabSCubed * 1.707614701
    ),
  ];
}

export function getCurrentTheme(): ThemeColor {
  return {
    accent: oklchToRgb(
      themeReactive.a0.l[0](),
      themeReactive.a0.c[0](),
      themeReactive.a0.h[0]()
    ),
    surface: oklchToRgb(
      themeReactive.b0.l[0](),
      themeReactive.b0.c[0](),
      themeReactive.b0.h[0]()
    ),
    contrast: oklchToRgb(
      themeReactive.c0.l[0](),
      themeReactive.c0.c[0](),
      themeReactive.c0.h[0]()
    ),
  };
}
