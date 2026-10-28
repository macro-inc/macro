/**
 * The engine operations for export presets, layout grids, and guides
 * (`fig_engine::edit::handoff`), and the guide list edits the canvas makes.
 */

import type {
  Axis,
  ExportSetting,
  GuideInfo,
  LayoutGridInfo,
} from '@core/fig-engine/handoff-types';

/** A layout grid as the engine takes it (`GridSpec`). */
export interface GridSpec {
  pattern: LayoutGridInfo['pattern'];
  axis: Axis;
  align: LayoutGridInfo['align'];
  visible: boolean;
  /** 0 for "Auto". */
  count: number;
  offset: number;
  sectionSize: number;
  gutter: number;
  /** `RRGGBBAA`. */
  color: string;
}

/** A guide as the engine takes it; `keep` keeps a guide's id. */
export interface GuideSpec {
  keep?: number;
  axis: Axis;
  offset: number;
}

export type HandoffOp =
  | { op: 'setExports'; ids: string[]; settings: ExportSetting[] }
  | { op: 'setLayoutGrids'; ids: string[]; grids: GridSpec[] }
  | { op: 'setGuides'; id: string; guides: GuideSpec[] };

export function gridSpec(g: LayoutGridInfo): GridSpec {
  const alpha = Math.round(Math.min(1, Math.max(0, g.alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return {
    pattern: g.pattern,
    axis: g.axis,
    align: g.align,
    visible: g.visible,
    count: g.count,
    offset: g.offset,
    sectionSize: g.sectionSize,
    gutter: g.gutter,
    color: `${g.color}${alpha}`.toUpperCase(),
  };
}

/** The guides kept as they are (by index, so their ids stay). */
const kept = (guides: readonly GuideInfo[]): GuideSpec[] =>
  guides.map((g, keep) => ({ keep, axis: g.axis, offset: g.offset }));

/** `guides` with a new one. */
export function addGuide(
  guides: readonly GuideInfo[],
  guide: GuideInfo
): GuideSpec[] {
  return [...kept(guides), { axis: guide.axis, offset: guide.offset }];
}

/** `guides` with guide `index` moved to `offset`. */
export function moveGuide(
  guides: readonly GuideInfo[],
  index: number,
  offset: number
): GuideSpec[] {
  return kept(guides).map((g) => (g.keep === index ? { ...g, offset } : g));
}

/** `guides` without guide `index`. */
export function removeGuide(
  guides: readonly GuideInfo[],
  index: number
): GuideSpec[] {
  return kept(guides).filter((g) => g.keep !== index);
}
