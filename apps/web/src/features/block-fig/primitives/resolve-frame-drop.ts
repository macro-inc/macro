import type { FigEngine } from '@core/fig-engine/client';
import type { NodeGeometry } from '@core/fig-engine/types';
import type { Point } from '../core/camera';
import type { Op } from './create-fig-editor';

function contains(geometry: NodeGeometry, point: Point) {
  const cross = geometry.corners.map(({ x, y }, i, corners) => {
    const next = corners[(i + 1) % corners.length];
    return (next.x - x) * (point.y - y) - (next.y - y) * (point.x - x);
  });
  return (
    cross.some((n) => Math.abs(n) > 0.001) &&
    (cross.every((n) => n >= -0.001) || cross.every((n) => n <= 0.001))
  );
}

/** Resolve a drop without letting the moving layers obscure its target. */
export async function resolveFrameDrop(
  engine: FigEngine,
  page: number,
  ids: string[],
  point: Point
): Promise<Op[]> {
  const excluded = new Set(ids);
  const find = async (parent?: string): Promise<string | undefined> => {
    const rows = (await engine.layers(page, parent)).filter(
      (r) =>
        r.visible &&
        !r.locked &&
        !r.inInstance &&
        !excluded.has(r.id) &&
        ['FRAME', 'SYMBOL', 'SECTION', 'GROUP'].includes(r.type)
    );
    const geometry = await engine.geometry(
      page,
      rows.map((r) => r.id)
    );
    // Layer rows are in front-to-back paint order. Only visit the branch
    // under the pointer, and never descend into the dragged subtree.
    for (const row of rows) {
      const bounds = geometry.find((g) => g.id === row.id);
      if (!bounds || !contains(bounds, point)) continue;
      const nested = row.childCount ? await find(row.id) : undefined;
      if (nested) return nested;
      if (row.type !== 'GROUP') return row.id;
    }
  };
  const frame = await find();
  const ancestry = await Promise.all(
    ids.map((id) => engine.ancestry(page, id))
  );
  // Retain existing groups when moving inside their enclosing frame.
  const moving = ids.filter((_, i) => {
    const containers = ancestry[i]
      .slice(0, -1)
      .filter((r) => ['FRAME', 'SYMBOL', 'SECTION'].includes(r.type));
    return containers.at(-1)?.id !== frame;
  });
  if (!moving.length) return [];
  const parent = frame ?? (await engine.currentSummary()).pages[page].id;
  const children = (await engine.layers(page, frame)).reverse();
  const info = frame ? await engine.nodeInfo(page, frame) : undefined;
  let index = children.length;
  const auto = info?.autoLayout;
  if (frame && auto && ['HORIZONTAL', 'VERTICAL'].includes(auto.mode)) {
    const [geometry] = await engine.geometry(page, [frame]);
    const origin = geometry.corners[0];
    const end = geometry.corners[auto.mode === 'HORIZONTAL' ? 1 : 3];
    const project = (x: number, y: number) =>
      (x - origin.x) * (end.x - origin.x) + (y - origin.y) * (end.y - origin.y);
    const at = project(point.x, point.y);
    const candidates = children.filter((r) => r.visible && !excluded.has(r.id));
    const details = await Promise.all(
      candidates.map((r) => engine.nodeInfo(page, r.id))
    );
    const geometryRows = await engine.geometry(
      page,
      candidates.map((r) => r.id)
    );
    for (const child of details) {
      if (child.layoutParent === 'ABSOLUTE') continue;
      const g = geometryRows.find((g) => g.id === child.id)!;
      const center = {
        x: (g.corners[0].x + g.corners[2].x) / 2,
        y: (g.corners[0].y + g.corners[2].y) / 2,
      };
      if (at < project(center.x, center.y)) {
        index = children.findIndex((r) => r.id === child.id);
        break;
      }
    }
  }
  const ops: Op[] = [{ op: 'reorder', ids: moving, parent, index }];
  if (auto)
    ops.push({ op: 'set', ids: moving, props: { layoutPositioning: 'AUTO' } });
  return ops;
}
