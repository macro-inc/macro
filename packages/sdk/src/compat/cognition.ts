/**
 * The types of `@macro-inc/sdk/generated/cognition`: the generated client's, plus
 * the names it had before the API renamed them. Runtime code is the generated
 * module's; this file only adds type aliases.
 */
export * from '../../generated/cognition/index.js';

import type {
  CrmLoss,
  CrmLossCount,
  CrmReport,
} from '../../generated/cognition/index.js';

/** @deprecated Renamed `CrmLoss`: one loss type serves every CRM import. */
export type HubspotLoss = CrmLoss;
/** @deprecated Renamed `CrmLossCount`. */
export type HubspotLossCount = CrmLossCount;
/** @deprecated Renamed `CrmReport`: one report type serves every CRM import. */
export type HubspotReport = CrmReport;
