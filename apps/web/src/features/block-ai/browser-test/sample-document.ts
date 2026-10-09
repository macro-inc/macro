/**
 * Documents the browser tests open, built with the engine itself: a blank
 * one as the app creates it, and a sample with artwork on two layers.
 */

import { AiEngine } from '@core/ai-engine/client';
import type { Op, Paint } from '@core/ai-engine/types';

const rgb = (r: number, g: number, b: number): Paint => ({
  type: 'solid',
  color: { space: 'rgb', r, g, b },
});

/** The sample's colors, as the tests read them back from the canvas. */
export const SAMPLE_COLORS = {
  red: [230, 51, 51],
  blue: [51, 102, 230],
} as const;

/**
 * An 800 × 600 artboard "Poster": on layer "Layer 1" a red rectangle
 * "Red box" (100,100)–(300,250), a blue circle "Blue circle"
 * (400,100)–(600,300) with a black outline, and the text "Hello" (Inter
 * 48 pt, baseline at (100,450)); on layer "Notes" above it, nothing.
 */
export async function sampleDocument(): Promise<Uint8Array<ArrayBuffer>> {
  const blank = await AiEngine.blank(800, 600);
  const engine = await AiEngine.open(blank.slice().buffer, { helpers: 0 });
  try {
    const created = await engine.apply([
      {
        op: 'create',
        node: {
          type: 'rect',
          rect: { x0: 100, y0: 100, x1: 300, y1: 250 },
          fill: rgb(0.9, 0.2, 0.2),
          stroke: null,
        },
      },
      {
        op: 'create',
        node: {
          type: 'ellipse',
          rect: { x0: 400, y0: 100, x1: 600, y1: 300 },
          fill: rgb(0.2, 0.4, 0.9),
          stroke: {
            paint: rgb(0, 0, 0),
            width: 4,
            cap: 'butt',
            join: 'miter',
            miterLimit: 10,
            dash: [],
            dashOffset: 0,
          },
        },
      },
      {
        op: 'create',
        node: {
          type: 'text',
          at: { x: 100, y: 450 },
          text: 'Hello',
          family: 'Inter',
          style: 'Regular',
          size: 48,
          fill: rgb(0, 0, 0),
          width: null,
        },
      },
    ]);
    const [box, circle] = created.created;
    const summary = await engine.currentSummary();
    const board = summary.artboards[0];
    const names: Op[] = [
      { op: 'setNode', ids: [box], name: 'Red box' },
      { op: 'setNode', ids: [circle], name: 'Blue circle' },
      { op: 'newLayer', name: 'Notes', position: { type: 'top' } },
    ];
    if (board) names.push({ op: 'setArtboard', id: board.id, name: 'Poster' });
    await engine.apply(names);
    return await engine.save();
  } finally {
    engine.close();
  }
}
