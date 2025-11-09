import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import corvu from './tailwind-plugins/corvu';
import kobalte from './tailwind-plugins/kobalte';
import zIndex from './tailwind-plugins/zIndex';

export default {
  plugins: [
    /** https://kobalte.dev/docs/core/overview/styling#usage */
    kobalte({ prefix: 'ui' }),
    /** https://corvu.dev/docs/styling/#tailwindcss-plugin */
    corvu({ prefix: 'corvu' }),
    zIndex,
    /** Auto-expose theme colors as CSS custom properties */
    plugin(function ({ addBase, theme }) {
      const colors = theme('colors');
      const cssVars = Object.entries(colors).reduce(
        (acc, [key, value]) => {
          if (typeof value === 'string') {
            acc[`--color-${key}`] = value;
          }
          return acc;
        },
        {} as Record<string, string>
      );

      addBase({
        ':root': cssVars,
      });
    }),
  ],
} satisfies Config;
