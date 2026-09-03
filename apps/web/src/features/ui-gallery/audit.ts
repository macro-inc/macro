import report from './ui-audit.json';

/** One `@ui` component (or slot, e.g. `Panel.Body`) as counted by the audit. */
export type AuditComponent = {
  name: string;
  files: number;
  usages: number;
  withClass: number;
  withOverride: number;
  overrideRate: number;
  topOverrides: { token: string; count: number }[];
  sites: { file: string; line: number; classes: string }[];
  truncatedSites: number;
};

export type AuditHandRolled = {
  element: string;
  /** Null when the library has no component covering this element yet. */
  suggested: string | null;
  usages: number;
  files: number;
  libraryUsages: number | null;
  sites: { file: string; line: number }[];
  truncatedSites: number;
};

export type AuditReport = {
  generatedAt: string;
  scannedFiles: number;
  components: AuditComponent[];
  handRolled: AuditHandRolled[];
};

/**
 * Adoption data produced by `bun run ui-audit`, checked in so the gallery works
 * without running the script. Regenerate after a refactor — the page shows the
 * timestamp so staleness is visible.
 */
export const AUDIT = report as AuditReport;

/** Root components only; `Panel.Body` folds into `Panel`. */
export function isRoot(name: string): boolean {
  return !name.includes('.');
}

/** `Panel.Body` -> `Panel`, for matching a slot back to its docs page. */
export function rootName(name: string): string {
  return name.split('.')[0] ?? name;
}

export const TOTAL_USAGES = AUDIT.components.reduce(
  (sum, component) => sum + component.usages,
  0
);

export const TOTAL_OVERRIDES = AUDIT.components.reduce(
  (sum, component) => sum + component.withOverride,
  0
);
