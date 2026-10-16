import type { ImportSource } from '@service-cognition/import';
import type { Component, JSX } from 'solid-js';

export type ImportIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** The Macro surface an import fills: Drive, Tasks, the CRM, or Channels. */
export type ImportCategory = 'files' | 'tasks' | 'crm' | 'channels';

export type ImportProvider = {
  /** Pipedream app slug the provider connects through. */
  appSlug: string;
  name: string;
  /** What comes over, in a few words. */
  detail: string;
  icon: ImportIcon;
  /**
   * The import pipeline source that discovers and copies items without an
   * agent. Providers without one hand off to an agent chat once connected.
   */
  native?: ImportSource;
};

type ImportCategoryCopy = {
  /** Sidebar card heading. */
  headline: string;
  /** Sidebar card body; names the leading providers. */
  pitch: string;
  /** Sidebar card button and dialog title. */
  action: string;
  dialogDescription: string;
  /** Plural noun for imported items, as used in agent prompts. */
  items: string;
  /** Where imported items land, as used in agent prompts. */
  destination: string;
};

export type ImportCategoryConfig = ImportCategoryCopy & {
  category: ImportCategory;
  providers: readonly ImportProvider[];
};

/** Shown on every card and dialog; grounded in Macro's security page. */
export const IMPORT_SECURITY_NOTE = 'Encrypted in transit and at rest.';
