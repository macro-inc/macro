/**
 * The fixture's stand-in for Google Fonts and this computer's fonts, so
 * the browser tests need no network: every family's stylesheet names one
 * file, the bundled Inter (served by the fixture's server), and the
 * computer has "Nowhere Grotesk", Inter again under another name. Requests
 * are recorded for the tests.
 */

import type { FigFontSource } from '../context/fig-viewer-context';

declare const __FIG_FONT_URL__: string;

/** A family the fixture's computer has installed. */
export const LOCAL_FAMILY = 'Nowhere Grotesk';

export function fixtureFontSource(): FigFontSource & {
  requests: () => string[];
} {
  const requests: string[] = [];
  const bytes = async () => (await fetch(__FIG_FONT_URL__)).arrayBuffer();
  return {
    requests: () => [...requests],
    stylesheet: async (url) => {
      requests.push(url);
      const spec = new URL(url).searchParams.get('family') ?? '';
      const family = spec.split(':')[0];
      return `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: 100 900;
  src: url(${location.origin}${__FIG_FONT_URL__}) format('truetype');
}`;
    },
    file: async (url) => {
      requests.push(url);
      return (await fetch(url)).arrayBuffer();
    },
    localFonts: async () => [
      {
        family: LOCAL_FAMILY,
        style: 'Regular',
        fullName: `${LOCAL_FAMILY} Regular`,
        postscriptName: 'NowhereGrotesk-Regular',
        bytes,
      },
    ],
    grantedLocalFonts: async () => null,
  };
}
