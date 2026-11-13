import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { DashboardSource } from '../context/dashboard-source';
import type { Dashboard } from '../core/dashboard';

export type DashboardView =
  | { t: 'loading' }
  | { t: 'ready'; dashboard: Dashboard }
  /** No dashboard here, or a dashboard with no panes yet. */
  | { t: 'empty' }
  | { t: 'noAccess' }
  | { t: 'error' };

/**
 * What a dashboard pane shows. A loaded dashboard stays on screen through a
 * failed background refresh; only a first load that fails shows its failure.
 */
export function createDashboardView(
  source: Pick<DashboardSource, 'dashboard' | 'failure'>
): Accessor<DashboardView> {
  return () => {
    const dashboard = source.dashboard();
    if (dashboard) {
      return dashboard.view.widgets.length > 0
        ? { t: 'ready', dashboard }
        : { t: 'empty' };
    }

    const failure = source.failure();
    if (!failure) return { t: 'loading' };

    return match(failure)
      .returnType<DashboardView>()
      .with('missing', () => ({ t: 'empty' }))
      .with('forbidden', () => ({ t: 'noAccess' }))
      .with('failed', () => ({ t: 'error' }))
      .exhaustive();
  };
}
