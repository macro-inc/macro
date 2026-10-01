import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { CrmViewConfig } from '../core/saved-view';
import { createDefaultCrmView } from '../primitives/default-view';
import { useApplyCrmView } from './apply-view';
import { usePersonalCrmViews, useTeamCrmViews } from './use-crm';

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

  createDefaultCrmView({
    personalLoading: personal.isLoading,
    teamLoading: team.isLoading,
    personal: () => personal.defaultView()?.config,
    team: () => team.defaultView()?.config as CrmViewConfig | undefined,
    mobile: isTouchDevice,
    apply: applyView,
  });

  return null;
}
