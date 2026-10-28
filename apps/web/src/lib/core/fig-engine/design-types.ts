/**
 * The JSON shapes the `.fig` engine returns about a file's design system:
 * components, variants, component properties, and shared styles. Mirrors
 * the serde types in `crates/fig_engine/src/inspect/design.rs`.
 */

import type { EffectInfo, PaintInfo } from './types';

/** A component, component set, or style the panel names. */
export interface NodeRef {
  id: string;
  name: string;
}

/** A property value: one field set, by the property's kind. */
export interface ValueInfo {
  bool: boolean | null;
  text: string | null;
  component: NodeRef | null;
}

export type PropertyKind = 'BOOL' | 'TEXT' | 'INSTANCE_SWAP';

/** A variant property of an instance and the values its set offers. */
export interface VariantChoice {
  name: string;
  value: string;
  options: string[];
}

/** A boolean, text, or instance swap property of an instance. */
export interface InstanceProperty {
  /** The definition id edits name the property by. */
  id: string;
  name: string;
  kind: PropertyKind;
  value: ValueInfo;
  /** The instance sets its own value. */
  changed: boolean;
  /** Instance swap properties: components offered first. */
  preferred: NodeRef[];
}

export interface InstanceProperties {
  /** The instance's layer id. */
  id: string;
  name: string;
  variants: VariantChoice[];
  properties: InstanceProperty[];
}

export interface InstanceInfo extends InstanceProperties {
  /** The component it shows (a variant for component sets). */
  main: NodeRef | null;
  /** Its component set, for variants. */
  set: NodeRef | null;
  /** The page the main component is on; null for library components. */
  mainPage: number | null;
  /** Exposed nested instances. */
  nested: InstanceProperties[];
  /** Overrides or property values to reset. */
  changed: boolean;
}

export interface PropertyDef {
  id: string;
  name: string;
  kind: PropertyKind;
  default: ValueInfo;
  /** Layers bound to it. */
  bound: number;
}

export interface VariantProperty {
  id: string;
  name: string;
  values: string[];
  /** The selected variant's value. */
  value: string | null;
}

export interface ComponentPanel {
  /** Where properties are defined: the component set for variants. */
  owner: NodeRef;
  isSet: boolean;
  isVariant: boolean;
  variantProperties: VariantProperty[];
  properties: PropertyDef[];
  variants: NodeRef[];
}

export type BindableField = 'VISIBLE' | 'TEXT' | 'INSTANCE_SWAP';

export interface Binding {
  field: BindableField;
  kind: PropertyKind;
  /** The bound property's id. */
  property: string | null;
}

export interface LayerBindings {
  owner: NodeRef;
  fields: Binding[];
  properties: PropertyDef[];
  /** Nested instances: whether their properties show on instances. */
  exposed: boolean | null;
}

export interface AppliedStyles {
  fill: NodeRef | null;
  stroke: NodeRef | null;
  text: NodeRef | null;
  effect: NodeRef | null;
}

export interface DesignInfo {
  styles: AppliedStyles;
  instance: InstanceInfo | null;
  component: ComponentPanel | null;
  layer: LayerBindings | null;
  /** Frames: variable collections with several modes and the one picked. */
  modes: ModeChoice[];
  /** The color variables the paints are bound to, by paint. */
  variables: BoundVariables;
}

/** A variable collection with several modes; `mode` null inherits. */
export interface ModeChoice {
  collection: NodeRef;
  modes: NodeRef[];
  mode: string | null;
}

export interface BoundVariables {
  fills: (NodeRef | null)[];
  strokes: (NodeRef | null)[];
}

/** A variable's value in one mode: one field set. */
export interface VariableValueInfo {
  /** `RRGGBB`, with `alpha`. */
  color: string | null;
  alpha: number | null;
  number: number | null;
  text: string | null;
  bool: boolean | null;
  /** The variable the value comes from. */
  alias: string | null;
}

export interface VariableInfo {
  id: string;
  name: string;
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN' | 'OTHER';
  /** One per mode of the collection. */
  values: VariableValueInfo[];
}

export interface CollectionInfo {
  id: string;
  name: string;
  modes: NodeRef[];
  variables: VariableInfo[];
  /** From a library. */
  remote: boolean;
}

export type StyleType = 'FILL' | 'TEXT' | 'EFFECT' | 'GRID' | 'OTHER';

export interface StyleTextInfo {
  fontFamily: string | null;
  fontStyle: string | null;
  fontSize: number | null;
  lineHeight: [number, string] | null;
  letterSpacing: [number, string] | null;
}

export interface StyleInfo {
  id: string;
  name: string;
  type: StyleType;
  description: string | null;
  /** Imported from a library (not editable here). */
  remote: boolean;
  paints: PaintInfo[];
  effects: EffectInfo[];
  text: StyleTextInfo | null;
}
