import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ThemeV2Tokens } from '../types/themeTypes';
import { defineLegacyDefaultTheme } from './defineLegacyDefaultTheme';

const tokens: ThemeV2Tokens = isTouchDevice()
  ? {
      a0: { l: 0.75, c: 0.2, h: 59 },
      a1: { l: 0.75, c: 0.2, h: 99 },
      a2: { l: 0.75, c: 0.2, h: 139 },
      a3: { l: 0.75, c: 0.2, h: 179 },
      a4: { l: 0.75, c: 0.2, h: 219 },
      b0: { l: 0, c: 0, h: 21 },
      b1: { l: 0.18, c: 0, h: 21 },
      b2: { l: 0.23, c: 0, h: 21 },
      b3: { l: 0.25, c: 0, h: 21 },
      b4: { l: 0.28, c: 0, h: 21 },
      c0: { l: 0.95, c: 0, h: 21 },
      c1: { l: 0.83, c: 0, h: 21 },
      c2: { l: 0.75, c: 0, h: 21 },
      c3: { l: 0.63, c: 0, h: 21 },
      c4: { l: 0.55, c: 0, h: 21 },
    }
  : {
      a0: { l: 0.75, c: 0.2, h: 59 },
      a1: { l: 0.75, c: 0.2, h: 99 },
      a2: { l: 0.75, c: 0.2, h: 139 },
      a3: { l: 0.75, c: 0.2, h: 179 },
      a4: { l: 0.75, c: 0.2, h: 219 },
      b0: { l: 0.14, c: 0, h: 59 },
      b1: { l: 0.2, c: 0, h: 59 },
      b2: { l: 0.23, c: 0, h: 59 },
      b3: { l: 0.25, c: 0, h: 59 },
      b4: { l: 0.28, c: 0, h: 59 },
      c0: { l: 0.95, c: 0, h: 59 },
      c1: { l: 0.83, c: 0, h: 59 },
      c2: { l: 0.75, c: 0, h: 59 },
      c3: { l: 0.63, c: 0, h: 59 },
      c4: { l: 0.55, c: 0, h: 59 },
    };

export const macroDarkTheme = defineLegacyDefaultTheme({
  id: 'Macro Dark',
  tokens,
});
