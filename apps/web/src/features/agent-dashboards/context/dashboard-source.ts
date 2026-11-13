import type { Accessor } from 'solid-js';
import type { Dashboard, DashboardFailure } from '../core/dashboard';

/**
 * One dashboard read, as the viewer. `dashboard` stays set through a failed
 * background refresh; `failure` describes the latest settled request.
 */
export type DashboardSource = {
  /** Undefined until a dashboard has loaded for the current input. */
  dashboard: Accessor<Dashboard | undefined>;
  /** The first load for the current input, not a background refresh. */
  isLoading: Accessor<boolean>;
  failure: Accessor<DashboardFailure | undefined>;
  retry(): void;
};

/** How an account is shown: its name and whether it is an agent. */
export type AccountIdentity = {
  name: string;
  isAgent: boolean;
};
