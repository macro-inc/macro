/**
 * The Filter menu's filters with dialogs: their names and Photoshop's
 * starting settings.
 */

import type { FilterSpec } from '@core/psd-engine/types';

export type FilterKind =
  | 'gaussianBlur'
  | 'unsharpMask'
  | 'addNoise'
  | 'mosaic'
  | 'motionBlur';

export const FILTER_TITLES: Record<FilterKind, string> = {
  gaussianBlur: 'Gaussian Blur',
  unsharpMask: 'Unsharp Mask',
  addNoise: 'Add Noise',
  mosaic: 'Mosaic',
  motionBlur: 'Motion Blur',
};

export const FILTER_KINDS = Object.keys(FILTER_TITLES) as FilterKind[];

/** A filter's settings as its dialog opens. */
export function defaultFilter(kind: FilterKind): FilterSpec {
  switch (kind) {
    case 'gaussianBlur':
      return { type: 'gaussianBlur', radius: 4 };
    case 'unsharpMask':
      return { type: 'unsharpMask', amount: 1, radius: 1, threshold: 0 };
    case 'addNoise':
      return {
        type: 'addNoise',
        amount: 0.125,
        gaussian: false,
        monochrome: false,
        seed: 1,
      };
    case 'mosaic':
      return { type: 'mosaic', cell: 10 };
    case 'motionBlur':
      return { type: 'motionBlur', angle: 0, distance: 10 };
  }
}
