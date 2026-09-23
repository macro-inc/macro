import type { GraphicsDocument, GraphicsItem, LegacyRectangle } from './model';
import { createScene, freezeDocument } from './scene';

export type DecodeResult =
  | { ok: true; document: GraphicsDocument }
  | { ok: false; error: string };
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
function rectangle(value: Record<string, unknown>) {
  const g = value.geometry,
    a = value.appearance;
  if (
    !record(g) ||
    !finite(g.width) ||
    !finite(g.height) ||
    g.width <= 0 ||
    g.height <= 0 ||
    !record(a) ||
    typeof a.fill !== 'string' ||
    typeof a.stroke !== 'string'
  )
    throw new Error('Invalid rectangle');
}
/** TypeScript owns types. This explicit boundary validates external data before constructing a scene. */
export function decodeGraphicsDocument(value: unknown): DecodeResult {
  try {
    if (!record(value) || !record(value.items))
      throw new Error('Invalid graphics document');
    const rawItems = value.items;
    let document: GraphicsDocument;
    if (value.version === 1) {
      if (
        !Array.isArray(value.order) ||
        !value.order.every((id) => typeof id === 'string') ||
        value.order.length !== Object.keys(rawItems).length ||
        new Set(value.order).size !== value.order.length
      )
        throw new Error('Invalid legacy order');
      const seed: LegacyRectangle[] = value.order.map((id) => {
        const raw = rawItems[id];
        if (!record(raw) || raw.id !== id || raw.type !== 'rectangle')
          throw new Error('Invalid legacy item');
        rectangle(raw);
        if (
          !record(raw.geometry) ||
          !finite(raw.geometry.x) ||
          !finite(raw.geometry.y)
        )
          throw new Error('Invalid legacy position');
        return raw as LegacyRectangle;
      });
      document = createScene(seed);
    } else if (value.version === 2 && typeof value.rootId === 'string') {
      const items: Record<string, GraphicsItem> = {};
      for (const [id, raw] of Object.entries(rawItems)) {
        if (!record(raw) || raw.id !== id)
          throw new Error('Invalid node identity');
        if (raw.type !== 'surface') {
          if (raw.type !== 'group' && raw.type !== 'rectangle')
            throw new Error('Unsupported node type');
          if (
            !record(raw.placement) ||
            typeof raw.placement.parentId !== 'string' ||
            !finite(raw.placement.order) ||
            !Array.isArray(raw.transform) ||
            raw.transform.length !== 6 ||
            !raw.transform.every(finite)
          )
            throw new Error('Invalid node placement or transform');
          if (raw.type === 'rectangle') rectangle(raw);
        }
        Object.defineProperty(items, id, {
          value: raw as GraphicsItem,
          enumerable: true,
        });
      }
      document = freezeDocument({ version: 2, rootId: value.rootId, items });
    } else throw new Error('Unsupported document version');
    if (value.surface !== undefined) {
      const surface = value.surface;
      if (
        !record(surface) ||
        typeof surface.id !== 'string' ||
        !finite(surface.width) ||
        !finite(surface.height) ||
        surface.width <= 0 ||
        surface.height <= 0
      )
        throw new Error('Invalid image surface');
      document = freezeDocument({
        ...document,
        surface: {
          id: surface.id,
          width: surface.width,
          height: surface.height,
        },
      });
    }
    return { ok: true, document };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Invalid graphics document',
    };
  }
}
