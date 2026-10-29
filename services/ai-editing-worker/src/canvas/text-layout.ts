import {
  canLabel,
  freezeDocument,
  type GraphicsDocument,
  type TextFitRequest,
  type TextFitResult,
} from '@macro-inc/graphics';
import { match } from 'ts-pattern';
import type { CanvasOp, TextFitMode } from './schema';

/** Measure changed content/font/wrapping and explicit fits; translations do not reflow text. */
export function textFitRequests(
  before: GraphicsDocument,
  after: GraphicsDocument,
  ops: CanvasOp[]
): TextFitRequest[] {
  const policies = new Map<string, TextFitMode>();
  const forced = new Set<string>();
  for (const op of ops) {
    if (op.kind === 'fitText') {
      policies.set(op.id, op.mode);
      forced.add(op.id);
    }
    if ('fitText' in op && op.fitText) policies.set(op.id, op.fitText);
    if (['resize', 'textStyle', 'text'].includes(op.kind) && 'id' in op)
      forced.add(op.id);
  }
  return Object.values(after.items).flatMap((item) => {
    if (item.type !== 'text' && !(canLabel(item) && item.geometry.label))
      return [];
    const previous = before.items[item.id];
    if (
      !forced.has(item.id) &&
      JSON.stringify('geometry' in item ? item.geometry : null) ===
        JSON.stringify(
          previous && 'geometry' in previous ? previous.geometry : null
        )
    )
      return [];
    return [{ id: item.id, mode: policies.get(item.id) }];
  });
}

/** Rebase only measured geometry onto the fresh candidate; retain current placement/order. */
export function applyTextMeasurements(
  document: GraphicsDocument,
  measured: TextFitResult
): GraphicsDocument {
  const items = { ...document.items };
  for (const effect of measured.effects) {
    const pair = [
      items[effect.id],
      measured.document.items[effect.id],
    ] as const;
    items[effect.id] = match(pair)
      .with([{ type: 'text' }, { type: 'text' }], ([fresh, sized]) => ({
        ...fresh,
        geometry: sized.geometry,
      }))
      .with(
        [{ type: 'rectangle' }, { type: 'rectangle' }],
        ([fresh, sized]) => ({ ...fresh, geometry: sized.geometry })
      )
      .with([{ type: 'ellipse' }, { type: 'ellipse' }], ([fresh, sized]) => ({
        ...fresh,
        geometry: sized.geometry,
      }))
      .with(
        [{ type: 'connector' }, { type: 'connector' }],
        ([fresh, sized]) => ({ ...fresh, geometry: sized.geometry })
      )
      .otherwise(() => {
        throw new Error(
          'Canvas text target changed type while measuring. ReadCanvas before retrying.'
        );
      });
  }
  return freezeDocument({ ...document, items });
}
