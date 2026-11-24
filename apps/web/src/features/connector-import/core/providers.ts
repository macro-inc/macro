import type { RemoteFlag } from '@core/constant/featureFlags';
import type { ImportSource } from '@service-cognition/import';
import type { Component, JSX } from 'solid-js';

export type ImportIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** The Macro surface an import fills: Drive, Tasks, the CRM, or Channels. */
export type ImportCategory = 'files' | 'tasks' | 'crm' | 'channels';

export type ImportProvider = {
  /** Catalog app slug; also keys the provider's connection state. */
  appSlug: string;
  name: string;
  /** What comes over, in a few words. */
  detail: string;
  icon: ImportIcon;
  /**
   * The import ledger source the agent records copies under, so the user
   * and teammates are never handed a duplicate.
   */
  ledger?: ImportSource;
  /** Macro's own importer for a source with no import ledger. */
  importer?: 'fusion';
  /** Shown only while this flag is on; a flag still loading hides it. */
  flag?: RemoteFlag;
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
