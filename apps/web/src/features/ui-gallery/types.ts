import type { JSX } from 'solid-js';

/** Maturity of a documented component, surfaced as a badge on its page. */
export type DocStatus = 'stable' | 'beta' | 'deprecated' | 'internal';

/** Sidebar grouping. `Foundations` sorts first; the rest follow in this order. */
export const DOC_CATEGORIES = [
  'Foundations',
  'Actions',
  'Inputs',
  'Layout',
  'Navigation',
  'Overlays',
  'Feedback',
  'Data Display',
] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number];

export type DocDemo = {
  /**
   * Stable identifier that must match the `// #region demo:<id>` marker
   * wrapping this demo's source, so the code shown is the code that ran.
   */
  id: string;
  title: string;
  description?: string;
  render: () => JSX.Element;
  /** Surface depth for this demo's preview, overriding the page-level control. */
  depth?: 0 | 1 | 2 | 3 | 4;
  /** Stretch the demo across the preview instead of centering it. */
  fill?: boolean;
};

export type DocProp = {
  name: string;
  type: string;
  default?: string;
  required?: boolean;
  description?: string;
};

export type ComponentDoc = {
  /** Display name, e.g. `Button`. */
  name: string;
  category: DocCategory;
  /** One or two sentences on what the component is for. */
  description: string;
  status?: DocStatus;
  /** Import line shown above the demos. */
  import?: string;
  /**
   * Names this page documents, as exported from `@ui`. Drives the coverage
   * report, so a page covering several exports should list all of them.
   */
  exports?: string[];
  demos: DocDemo[];
  props?: DocProp[];
  /** Short usage rules. These are the lever for cross-app consistency. */
  guidelines?: { do?: string[]; dont?: string[] };
};

/** Identity helper that gives a `.docs.tsx` file its type checking. */
export function defineDoc(doc: ComponentDoc): ComponentDoc {
  return doc;
}
