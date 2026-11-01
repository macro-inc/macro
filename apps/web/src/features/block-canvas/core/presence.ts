import { shapePayload } from '@macro-inc/graphics';
import type { PeerPresence } from '@macro-inc/graphics/loro';
import { z } from 'zod';

const finite = z.number().finite();
const point = z.object({ x: finite, y: finite });
const bounds = point.extend({
  width: finite.nonnegative(),
  height: finite.nonnegative(),
});
const matrix = z.tuple([finite, finite, finite, finite, finite, finite]);
const color = z
  .string()
  .regex(
    /^(#[\da-fA-F]{3,8}|transparent|none|var\(--color-(?:ink|ink-muted|edge|edge-muted|panel|surface)\))$/
  );
const previewItem = z
  .object({
    type: z.enum(['rectangle', 'ellipse', 'connector', 'text']),
    geometry: z.string().max(60_000),
    appearance: z.object({
      fill: color,
      stroke: color,
      strokeWidth: finite.nonnegative().max(100).optional(),
      opacity: finite.min(0).max(1).optional(),
      cornerRadius: finite.nonnegative().optional(),
      strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    }),
  })
  .refine((item) => {
    try {
      shapePayload(item.type, JSON.parse(item.geometry));
      return true;
    } catch {
      return false;
    }
  });
const presenceSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(200),
  color: z.string().max(100),
  cursor: point.nullable(),
  selectedIds: z.array(z.string().max(200)).max(1000),
  clock: z.record(z.string(), z.number().int().nonnegative()),
  reducedMotion: z.boolean().optional(),
  lanes: z
    .array(
      z.object({
        id: z.string().max(40),
        name: z.string().max(80),
        color: z.string().max(100),
        itemIds: z.array(z.string().max(200)).min(1).max(100),
        cursor: point.nullable(),
      })
    )
    .max(3)
    .optional(),
  preview: z
    .object({
      kind: z.enum([
        'draw',
        'move',
        'resize',
        'scale',
        'rotate',
        'radius',
        'marquee',
        'ai',
      ]),
      shapes: z
        .array(
          z.object({
            id: z.string().max(200),
            kind: z.enum(['rectangle', 'ellipse', 'pencil']),
            width: finite.nonnegative(),
            height: finite.nonnegative(),
            world: matrix,
            item: previewItem.optional(),
            pencil: z
              .object({
                points: z.array(z.tuple([finite, finite, finite])).max(2048),
                simulatePressure: z.boolean(),
              })
              .optional(),
            strokeWidth: finite.nonnegative().optional(),
            cornerRadius: finite.nonnegative().optional(),
          })
        )
        .max(256)
        .refine((shapes) =>
          shapes.every((shape) => shape.kind !== 'pencil' || !!shape.pencil)
        ),
      box: point
        .extend({ width: finite.nonnegative(), height: finite.nonnegative() })
        .nullable(),
      guard: z
        .object({
          items: z.record(
            z.string().max(200),
            z.string().max(60_000).nullable()
          ),
          regions: z.array(bounds).max(200),
          occupants: z.array(z.string().max(200)).max(5000),
        })
        .optional(),
    })
    .nullable(),
});

/** Presence is untrusted ephemeral input; invalid packets never reach rendering. */
export function decodeCanvasPresence(value: string): PeerPresence | null {
  if (typeof value !== 'string' || value.length > 128_000) return null;
  try {
    const parsed = presenceSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const laneIds = new Set<string>();
    const targets = new Set<string>();
    for (const lane of parsed.data.lanes ?? []) {
      if (laneIds.has(lane.id)) return null;
      laneIds.add(lane.id);
      for (const id of lane.itemIds) {
        if (targets.has(id) || !parsed.data.selectedIds.includes(id))
          return null;
        targets.add(id);
      }
    }
    return parsed.data;
  } catch {
    return null;
  }
}
