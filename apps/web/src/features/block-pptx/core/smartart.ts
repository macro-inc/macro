/**
 * SmartArt logic without UI: the text pane's lines and what its keys do,
 * finding nodes on the stage, and how the galleries group layouts and
 * color variations (PowerPoint's Choose a SmartArt Graphic and Change
 * Colors).
 */

import type {
  ShapeOutline,
  SmartArtCatalog,
  SmartArtCatalogItem,
  SmartArtCatalogLayout,
  SmartArtEdit,
  SmartArtNodeOutline,
  SmartArtOutline,
} from '@core/pptx-engine/types';

/** PowerPoint's prompt in empty SmartArt nodes. */
export const PROMPT = '[Text]';

/** One bullet of the text pane. */
export interface PaneLine {
  id: string;
  text: string;
  /** 1 for top-level nodes. */
  level: number;
}

/** The text pane's lines: one per node, in order. */
export function paneLines(outline: SmartArtOutline): PaneLine[] {
  return outline.nodes.map((n) => ({
    id: n.id,
    // The pane edits one line per node; paragraphs show as spaces.
    text: n.text.replace(/[\n\v]/g, ' '),
    level: n.level,
  }));
}

/** Whether the line at `index` can move one level down (Tab). */
export function canDemote(lines: PaneLine[], index: number): boolean {
  const line = lines[index];
  if (!line) return false;
  // It needs an earlier sibling: a previous line at its level under the same parent.
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].level < line.level) return false;
    if (lines[i].level === line.level) return true;
  }
  return false;
}

/** Whether the line at `index` can move one level up (Shift+Tab). */
export function canPromote(lines: PaneLine[], index: number): boolean {
  return (lines[index]?.level ?? 1) > 1;
}

/** What a key in the text pane does. */
export type PaneAction =
  /** Enter: a new node after this one, with the text after the caret. */
  | { kind: 'split'; node: string; before: string; after: string }
  | { kind: 'demote'; node: string }
  | { kind: 'promote'; node: string }
  /** Backspace on an empty bullet: delete it and go to the end of `focus`. */
  | { kind: 'delete'; node: string; focus?: string }
  /** Arrow keys: move to another line, the caret at `at` (`end` or a column). */
  | { kind: 'focus'; node: string; at: 'end' | 'start' }
  | { kind: 'none' };

/** The action for `key` on line `index` with the caret at `caret` in `value`. */
export function paneKey(
  lines: PaneLine[],
  index: number,
  key: { key: string; shift: boolean },
  value: string,
  caret: { start: number; end: number }
): PaneAction {
  const line = lines[index];
  if (!line) return { kind: 'none' };
  switch (key.key) {
    case 'Enter':
      if (key.shift) return { kind: 'none' };
      return {
        kind: 'split',
        node: line.id,
        before: value.slice(0, caret.start),
        after: value.slice(caret.end),
      };
    case 'Tab':
      if (key.shift)
        return canPromote(lines, index)
          ? { kind: 'promote', node: line.id }
          : { kind: 'none' };
      return canDemote(lines, index)
        ? { kind: 'demote', node: line.id }
        : { kind: 'none' };
    case 'Backspace':
      if (value === '' && lines.length > 1)
        return {
          kind: 'delete',
          node: line.id,
          focus: lines[index - 1]?.id ?? lines[index + 1]?.id,
        };
      // At the start of a bullet below the top level, Backspace promotes it.
      if (caret.start === 0 && caret.end === 0 && line.level > 1)
        return { kind: 'promote', node: line.id };
      return { kind: 'none' };
    case 'ArrowUp':
      return index > 0
        ? { kind: 'focus', node: lines[index - 1].id, at: 'end' }
        : { kind: 'none' };
    case 'ArrowDown':
      return index + 1 < lines.length
        ? { kind: 'focus', node: lines[index + 1].id, at: 'end' }
        : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}

/** The node an edit created: the one in `after` that `before` lacks. */
export function newNodeId(
  before: SmartArtOutline | undefined,
  after: SmartArtOutline | undefined
): string | undefined {
  if (!after) return undefined;
  const old = new Set(before?.nodes.map((n) => n.id) ?? []);
  return after.nodes.find((n) => !old.has(n.id))?.id;
}

/** A node's box on the slide (points), from its frame relative to `shape`. */
export function nodeBox(
  shape: ShapeOutline,
  node: SmartArtNodeOutline
): { x: number; y: number; w: number; h: number } | undefined {
  if (!node.frame) return undefined;
  const [x, y, w, h] = node.frame;
  return { x: shape.x + x, y: shape.y + y, w, h };
}

/**
 * The node whose shape is under `at` (slide points): the smallest box that
 * contains the point, so text inside a background shape wins.
 */
export function nodeAt(
  shape: ShapeOutline,
  at: { x: number; y: number }
): SmartArtNodeOutline | undefined {
  const nodes = shape.smartArt?.nodes ?? [];
  let best: SmartArtNodeOutline | undefined;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    const b = nodeBox(shape, n);
    if (!b) continue;
    if (at.x < b.x || at.x > b.x + b.w || at.y < b.y || at.y > b.y + b.h)
      continue;
    const area = b.w * b.h;
    if (area < bestArea) {
      best = n;
      bestArea = area;
    }
  }
  return best;
}

/** The SmartArt gallery categories, in PowerPoint's order. */
export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'list', label: 'List' },
  { id: 'process', label: 'Process' },
  { id: 'cycle', label: 'Cycle' },
  { id: 'hierarchy', label: 'Hierarchy' },
  { id: 'relationship', label: 'Relationship' },
  { id: 'pyramid', label: 'Pyramid' },
];

/** The layouts of a gallery category (`all` lists each layout once). */
export function layoutsIn(
  catalog: SmartArtCatalog | undefined,
  category: string
): SmartArtCatalogLayout[] {
  const layouts = catalog?.layouts ?? [];
  return category === 'all'
    ? layouts
    : layouts.filter((l) => l.categories.includes(category));
}

/** What PowerPoint's dialog says about each layout. */
export const LAYOUT_DESCRIPTIONS: Record<string, string> = {
  default:
    'Use to show non-sequential or grouped blocks of information. Maximizes both horizontal and vertical display space for shapes.',
  vList2:
    'Use to show non-sequential or grouped blocks of text. Works well for lists with long headings or top-level information.',
  hList1:
    'Use to show non-sequential or grouped lists of information. Works well for large amounts of text. All text has the same level of emphasis.',
  process1:
    'Use to show a progression or sequential steps in a task, process, or workflow.',
  chevron1:
    'Use to show a progression; a timeline; sequential steps in a task, process, or workflow; or to emphasize movement or direction.',
  cycle2:
    'Use to represent a continuing sequence of stages, tasks, or events in a circular flow. Emphasizes the stages or steps rather than the connecting arrows or flow.',
  radial1:
    'Use to show the relationship to a central idea in a cycle. The first line of Level 1 text corresponds to the central shape, and its Level 2 text corresponds to the surrounding shapes.',
  hierarchy1:
    'Use to show hierarchical relationships progressing from top to bottom.',
  orgChart1:
    'Use to show hierarchical information or reporting relationships in an organization. The assistant shape and the Org Chart hanging layouts are available with this layout.',
  venn1:
    'Use to show overlapping or interconnected relationships. The first seven lines of Level 1 text correspond with a circle.',
  pyramid1:
    'Use to show containment, proportional, or interconnected relationships. The first line of Level 1 text appears in the top segment of the pyramid.',
};

/** A titled group of color variations. */
export interface ColorGroup {
  label: string;
  items: SmartArtCatalogItem[];
}

/** Change Colors' groups: Primary Theme Colors, Colorful, Accent 1-6. */
export function colorGroups(
  catalog: SmartArtCatalog | undefined
): ColorGroup[] {
  const groups: ColorGroup[] = [];
  for (const item of catalog?.colors ?? []) {
    const label =
      item.category === 'mainScheme'
        ? 'Primary Theme Colors'
        : item.category === 'colorful'
          ? 'Colorful'
          : `Accent ${item.category.replace('accent', '')}`;
    const group = groups.find((g) => g.label === label);
    if (group) group.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** The last part of a SmartArt id (`…/layout/process1` → `process1`). */
export function shortId(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/** The edit that applies a pane action (`split` adds a node; see `PaneAction`). */
export function paneEdit(action: PaneAction): SmartArtEdit | undefined {
  switch (action.kind) {
    case 'split':
      return {
        action: 'addNode',
        node: action.node,
        position: 'after',
        text: action.after,
      };
    case 'demote':
      return { action: 'demote', node: action.node };
    case 'promote':
      return { action: 'promote', node: action.node };
    case 'delete':
      return { action: 'deleteNode', node: action.node };
    default:
      return undefined;
  }
}
