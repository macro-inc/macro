/**
 * Design system logic for the design panel: the engine operations for
 * component properties, variants, and shared styles, and the pure helpers
 * the panel sections use (grouping styles, naming properties, labels).
 */

import type {
  BindableField,
  NodeRef,
  PropertyKind,
  StyleInfo,
  StyleType,
  ValueInfo,
} from '@core/fig-engine/design-types';
import type { ComponentInfo } from '@core/fig-engine/types';

/** A property value as the engine takes it. */
export type PropertyInput =
  | { bool: boolean }
  | { text: string }
  | { component: string }
  | { variant: string };

/** What a style styles, as the panel's sections apply it. */
export type StyleKind = 'FILL' | 'STROKE' | 'TEXT' | 'EFFECT';

/** Engine operations (`fig_engine::edit::Op`) for design systems. */
export type DesignOp =
  | {
      op: 'setProperty';
      ids: string[];
      property: string;
      value: PropertyInput;
    }
  | { op: 'swapInstance'; ids: string[]; component: string }
  | { op: 'resetInstance'; ids: string[]; property?: string }
  | { op: 'combineAsVariants'; ids: string[] }
  | { op: 'addVariant'; set: string; from?: string }
  | { op: 'addVariantProperty'; set: string; name: string; value: string }
  | { op: 'renameVariantProperty'; set: string; from: string; to: string }
  | { op: 'removeVariantProperty'; set: string; name: string }
  | { op: 'setVariantValue'; ids: string[]; property: string; value: string }
  | {
      op: 'addComponentProperty';
      component: string;
      name: string;
      kind: PropertyKind | 'VARIANT';
      value?: PropertyInput;
      layer?: string;
    }
  | {
      op: 'editComponentProperty';
      component: string;
      property: string;
      name?: string;
      value?: PropertyInput;
    }
  | { op: 'deleteComponentProperty'; component: string; property: string }
  | {
      op: 'bindProperty';
      ids: string[];
      field: BindableField;
      property?: string;
    }
  | { op: 'exposeInstance'; ids: string[]; exposed: boolean }
  | { op: 'applyStyle'; ids: string[]; kind: StyleKind; style?: string }
  | { op: 'createStyle'; kind: StyleKind; name: string; from: string }
  | {
      op: 'editStyle';
      style: string;
      name?: string;
      props?: Record<string, unknown>;
    }
  | { op: 'deleteStyle'; ids: string[] }
  | {
      op: 'bindVariable';
      ids: string[];
      field: 'FILL' | 'STROKE';
      index: number;
      variable?: string;
    }
  | {
      op: 'setVariableMode';
      ids: string[];
      collection: string;
      mode?: string;
    };

/** The style type a kind of style is stored as (fills and strokes share). */
export const styleTypeFor = (kind: StyleKind): StyleType =>
  kind === 'STROKE' ? 'FILL' : kind;

export const STYLE_TYPE_LABELS: Record<Exclude<StyleType, 'OTHER'>, string> = {
  FILL: 'Color styles',
  TEXT: 'Text styles',
  EFFECT: 'Effect styles',
  GRID: 'Grid styles',
};

/** A style's folder (`Brand/Primary` → `Brand`) and its own name. */
export function splitStyleName(name: string): { folder: string; leaf: string } {
  const at = name.lastIndexOf('/');
  if (at < 0) return { folder: '', leaf: name.trim() };
  return {
    folder: name.slice(0, at).trim(),
    leaf: name.slice(at + 1).trim(),
  };
}

export interface StyleGroup {
  folder: string;
  styles: StyleInfo[];
}

/**
 * Styles of one type grouped by folder, in their order, local ones first;
 * filtered by a search query on the full name.
 */
export function groupStyles(
  styles: readonly StyleInfo[],
  type: StyleType,
  query = ''
): StyleGroup[] {
  const q = query.trim().toLowerCase();
  const groups: StyleGroup[] = [];
  for (const s of styles) {
    if (s.type !== type) continue;
    if (q && !s.name.toLowerCase().includes(q)) continue;
    const folder = `${s.remote ? 'Libraries' : ''}${s.remote && splitStyleName(s.name).folder ? ' / ' : ''}${splitStyleName(s.name).folder}`;
    const group = groups.find((g) => g.folder === folder);
    if (group) group.styles.push(s);
    else groups.push({ folder, styles: [s] });
  }
  return groups;
}

/** `name`, or `name 2`, `name 3`… when another property has it. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = name.trim() || 'Property';
  if (!taken.includes(base)) return base;
  for (let k = 2; ; k++) {
    const next = `${base} ${k}`;
    if (!taken.includes(next)) return next;
  }
}

/** The default name a new property of `kind` gets. */
export function defaultPropertyName(
  kind: PropertyKind | 'VARIANT',
  taken: readonly string[]
): string {
  const base =
    kind === 'BOOL'
      ? 'Show'
      : kind === 'TEXT'
        ? 'Text'
        : kind === 'INSTANCE_SWAP'
          ? 'Instance'
          : 'Property';
  return uniqueName(base, taken);
}

export const PROPERTY_KIND_LABELS: Record<PropertyKind | 'VARIANT', string> = {
  BOOL: 'Boolean',
  TEXT: 'Text',
  INSTANCE_SWAP: 'Instance swap',
  VARIANT: 'Variant',
};

/** A property value as text, for read-only views. */
export function valueLabel(value: ValueInfo): string {
  if (value.bool !== null) return value.bool ? 'On' : 'Off';
  if (value.text !== null) return value.text;
  if (value.component) return value.component.name;
  return '';
}

/** The field a property kind drives on a layer. */
export const FIELD_FOR_KIND: Record<PropertyKind, BindableField> = {
  BOOL: 'VISIBLE',
  TEXT: 'TEXT',
  INSTANCE_SWAP: 'INSTANCE_SWAP',
};

/**
 * Components an instance can swap to: the preferred ones first, then the
 * rest of the file's (by set, then name), filtered by a query.
 */
export function swapChoices(
  components: readonly ComponentInfo[],
  preferred: readonly NodeRef[],
  query = ''
): { preferred: ComponentInfo[]; others: ComponentInfo[] } {
  const q = query.trim().toLowerCase();
  const label = (c: ComponentInfo) => (c.set ? `${c.set} / ${c.name}` : c.name);
  const matches = (c: ComponentInfo) =>
    !q || label(c).toLowerCase().includes(q);
  const ids = new Set(preferred.map((p) => p.id));
  const first = preferred
    .map((p) => components.find((c) => c.id === p.id))
    .filter((c): c is ComponentInfo => !!c && matches(c));
  const others = components
    .filter((c) => !ids.has(c.id) && matches(c))
    .sort((a, b) => label(a).localeCompare(label(b)));
  return { preferred: first, others };
}

/** A component's label in pickers: `Set / Variant` for variants. */
export const componentLabel = (c: ComponentInfo) =>
  c.set ? `${c.set} / ${c.name}` : c.name;

/** Components grouped for the assets list: component sets together. */
export function groupComponents(
  components: readonly ComponentInfo[],
  query = ''
): { set: string | null; components: ComponentInfo[] }[] {
  const q = query.trim().toLowerCase();
  const groups: { set: string | null; components: ComponentInfo[] }[] = [];
  for (const c of components) {
    if (q && !componentLabel(c).toLowerCase().includes(q)) continue;
    const group = c.set ? groups.find((g) => g.set === c.set) : undefined;
    if (group) group.components.push(c);
    else groups.push({ set: c.set, components: [c] });
  }
  return groups;
}
