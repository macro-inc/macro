import { useApplyCrmView } from '@app/features/next-soup/soup-view/views/companies/use-apply-crm-view';
import {
  type CrmViewConfig,
  usePersonalCrmViews,
  useTeamCrmViews,
} from '@companies/crm/saved-views';
import { createEffect } from 'solid-js';

/**
 * Applies the default saved view (personal wins over team) once its queries
 * settle. Mounted only on a fresh Customers entry — never for restored
 * (back/forward) entries or `?crmView=` share links, which carry their own
 * state. One-shot: later refetches never re-apply, so a default set while
 * the view is open doesn't yank the user's state out from under them.
 */
export function CrmDefaultViewLoader() {
  const personal = usePersonalCrmViews();
  const team = useTeamCrmViews();
  const applyView = useApplyCrmView();

  let applied = false;
  createEffect(() => {
    if (applied || personal.isLoading() || team.isLoading()) return;
    applied = true;
    const config =
      personal.defaultView()?.config ??
      (team.defaultView()?.config as CrmViewConfig | undefined);
    if (config) applyView(config);
  });

  return null;
}
