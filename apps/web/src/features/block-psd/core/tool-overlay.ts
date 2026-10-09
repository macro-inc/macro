/**
 * What the tool in use shows over the canvas (marquees, lassos, the
 * gradient line, shapes, the crop box, Free Transform, the brush's
 * footprint), in canvas pixels.
 */

import type { IRect } from '@core/psd-engine/types';
import type { Point } from './selection-math';
import type { FreeTransform } from './transform';

/** A layer drawn transformed while Free Transform shows it. */
export interface TransformImage {
  image: CanvasImageSource;
  /** Canvas position of its top left (before the transform). */
  x: number;
  y: number;
}

export interface ToolOverlay {
  marquee?: { kind: 'rect' | 'ellipse'; rect: IRect };
  lasso?: { points: Point[]; cursor?: Point; closing: boolean };
  line?: [Point, Point];
  shape?: { kind: 'rectangle' | 'ellipse'; rect: IRect };
  crop?: IRect;
  transform?: { box: FreeTransform; images: TransformImage[] };
  /** The brush's footprint. */
  brush?: { at: Point; size: number };
}
