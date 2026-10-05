import type { FigEngine } from '@core/fig-engine/client';
import type { FontUse } from '@core/fig-engine/types';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { FigFontSource } from '../context/fig-viewer-context';
import { parseCatalog } from '../core/fonts';
import { createFontRegistry } from './create-font-registry';

/** An engine that registers fonts by family and reports their status. */
function fakeEngine(used: { family: string; style: string }[]) {
  const registered: { family: string | undefined; size: number }[] = [];
  const engine = {
    registerFont: async (bytes: ArrayBuffer, family?: string) => {
      registered.push({ family, size: bytes.byteLength });
      return [
        {
          family: family ?? 'X',
          style: 'Regular',
          weight: 400,
          maxWeight: 400,
          italic: false,
          variable: false,
        },
      ];
    },
    fonts: async (): Promise<FontUse[]> =>
      used.map((u) => ({
        ...u,
        layers: 1,
        status: registered.some((r) => r.family === u.family)
          ? 'AVAILABLE'
          : 'MISSING',
      })),
  };
  return { engine: engine as unknown as FigEngine, registered };
}

const catalog = async () =>
  parseCatalog([
    ['Roboto', 's', '123456789', '123456789', 'wght:100-900'],
    ['Lato', 's', '13479', '13479', ''],
  ]);

const CSS = (family: string) => `
@font-face { font-family: '${family}'; font-style: normal; font-weight: 100 900;
  src: url(https://g.test/${family}-cyr.woff2); unicode-range: U+0400-045F; }
@font-face { font-family: '${family}'; font-style: normal; font-weight: 100 900;
  src: url(https://g.test/${family}-latin.woff2); unicode-range: U+0000-00FF; }`;

function fakeSource(local: string[] = []) {
  const requests: string[] = [];
  const source: FigFontSource = {
    stylesheet: async (url) => {
      requests.push(url);
      const family = new URL(url).searchParams.get('family')?.split(':')[0];
      return CSS(family ?? '');
    },
    file: async (url) => {
      requests.push(url);
      return new ArrayBuffer(8);
    },
    localFonts: async () =>
      local.map((family) => ({
        family,
        style: 'Regular',
        fullName: family,
        postscriptName: family,
        bytes: async () => new ArrayBuffer(4),
      })),
  };
  return { source, requests };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the font registry', () => {
  it('loads Google families for the text’s scripts, once', async () => {
    const { engine, registered } = fakeEngine([
      { family: 'Roboto', style: 'Bold' },
    ]);
    const { source, requests } = fakeSource();
    await createRoot(async (dispose) => {
      const fonts = createFontRegistry({ engine, source, catalog });
      expect(await fonts.ensure('Roboto', 'Bold', 'Hello')).toBe(true);
      expect(registered).toEqual([{ family: 'Roboto', size: 8 }]);
      expect(requests.filter((r) => r.endsWith('.woff2'))).toEqual([
        'https://g.test/Roboto-latin.woff2',
      ]);
      // Cyrillic text adds its subset; nothing is fetched twice.
      await fonts.ensure('Roboto', 'Regular', 'Привет');
      await fonts.ensure('Roboto', 'Regular', 'Привет');
      expect(requests.filter((r) => r.endsWith('.woff2'))).toEqual([
        'https://g.test/Roboto-latin.woff2',
        'https://g.test/Roboto-cyr.woff2',
      ]);
      expect(requests.filter((r) => r.includes('css2'))).toHaveLength(1);
      // Inter is bundled; unknown families are not fetched.
      expect(await fonts.ensure('Inter', 'Bold')).toBe(true);
      expect(await fonts.ensure('Nowhere Grotesk', 'Regular')).toBe(false);
      dispose();
    });
  });

  it('lists missing fonts, and finds them on this computer', async () => {
    const { engine, registered } = fakeEngine([
      { family: 'Roboto', style: 'Regular' },
      { family: 'Brand Sans', style: 'Bold' },
    ]);
    const { source } = fakeSource(['Brand Sans']);
    await createRoot(async (dispose) => {
      const fonts = createFontRegistry({ engine, source, catalog });
      await settle();
      await settle();
      // Roboto loads from Google when needed; Brand Sans is missing.
      expect(fonts.missing().map((f) => f.family)).toEqual(['Brand Sans']);
      expect(fonts.canLoad('roboto')).toBe(true);
      expect(fonts.canLoad('Brand Sans')).toBe(false);
      expect(fonts.weightsOf('Lato')).toEqual([100, 300, 400, 700, 900]);
      expect(fonts.weightsOf('Roboto')).toHaveLength(9);
      await fonts.useLocalFonts();
      expect(registered).toEqual([{ family: 'Brand Sans', size: 4 }]);
      expect(fonts.missing()).toEqual([]);
      // A local family is preferred over Google from then on.
      expect(await fonts.ensure('Brand Sans', 'Bold')).toBe(true);
      dispose();
    });
  });
});
