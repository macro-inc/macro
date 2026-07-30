/**
 * The backend services the SDK is generated against. Shared by
 * orval.config.ts (which reads ./specs/<service>.json) and
 * scripts/sync-specs.ts (which refreshes those specs from the monorepo's
 * service-clients package).
 */
export const services = [
  'auth',
  'cognition',
  'connection',
  'contacts',
  'email',
  'notification',
  'properties',
  'scheduled-action',
  'search',
  'static-files',
  'storage',
  'unfurl',
] as const;

export type ServiceSpec = (typeof services)[number];
