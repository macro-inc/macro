/**
 * Shared vite-plugin-solid-svg options, used by both the client build
 * (vite.config.ts) and the prerender build (vite.prerender.config.ts) so the
 * static HTML and the client render produce identical markup.
 */
import type { SolidSVGPluginOptions } from 'vite-plugin-solid-svg';

export const solidSvgOptions: SolidSVGPluginOptions = {
  svgo: {
    // Must be set explicitly: the plugin only defaults enabled to true
    // when the whole svgo object is omitted.
    enabled: true,
    svgoConfig: {
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              // Keep original (per-export-unique) ids: svgo's default id
              // minification renames every inlined svg's ids to a, b, c…
              // so url(#…) references in one svg resolve into another
              // svg's defs when several are inlined on the same page.
              cleanupIds: false,
              // Keep <style> rules as authored: inlining strips the class
              // attributes whose base rules it absorbs, which orphans the
              // :hover and keyframe rules that reference those classes. Seven
              // of the fig-* and empty-state graphics are built that way.
              inlineStyles: false,
              // Keep viewBox: svgo drops it when it matches width/height,
              // which is fine for a graphic rendered at its natural size but
              // makes one scaled by CSS (the /tasks hero graphic, sized to
              // its column) render its contents at 1:1 and overflow.
              removeViewBox: false,
            },
          },
        },
      ],
    },
  },
};
