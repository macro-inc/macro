import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import type { Source } from '@core/source';
import { ok } from '@core/util/maybeResult';
import BlockColor from './component/Block';
import { type ColorBlock, parseColorBlock } from './type/ColorBlock';
import { getRandomOklch } from './util/getRandomOklch';

export const definition = defineBlock({
  name: 'color',
  description:
    'Displays a grid of colors, when the spec matches our theme spec, can be used as a Theme Primitive',
  accepted: {},
  component: BlockColor,
  async load(source: Source, intent) {
    if (source.type === 'dss') {
      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      const parseFromUrl = (): ColorBlock | undefined => {
        try {
          const search =
            typeof window !== 'undefined' ? window.location.search : '';
          const params = new URLSearchParams(search);
          const raw = params.get('state');
          if (!raw) return undefined;
          const decoded = decodeURIComponent(raw);
          const obj = JSON.parse(decoded);
          return parseColorBlock(obj);
        } catch {}
        return undefined;
      };

      const initial: ColorBlock = {
        name: 'New Colors',
        columns: [
          {
            colors: [{ color: getRandomOklch() }],
          },
          {
            colors: [{ color: getRandomOklch() }],
          },
          {
            colors: [{ color: getRandomOklch() }],
          },
        ],
      };

      const colorBlock = parseFromUrl() ?? initial;

      return ok({
        id: source.id,
        colorBlock,
      } as const);
    }
    return LoadErrors.INVALID;
  },
});

export type ColorBlockData = ExtractLoadType<(typeof definition)['load']>;
