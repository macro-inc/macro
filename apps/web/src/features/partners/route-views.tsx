import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enablePartnerPortal } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import { Show } from 'solid-js';
import { usePartnerPortalAccess } from './use-partner-portal-access';
import { PartnersView } from './views/partners-view';

function TrackedPartnersView() {
  usePageViewTracking('partners');
  return <PartnersView />;
}

/**
 * `/partners`. A direct link goes Home when the flag is off, or when the
 * account is neither Macro staff nor an accepted partner.
 */
export const PartnersRouteView = withAuth(() => {
  const flag = useFeatureFlag(enablePartnerPortal);
  const email = useEmail();
  const access = usePartnerPortalAccess();
  return (
    <Show
      when={!flag().loading && email() !== undefined}
      fallback={<LoadingBlock />}
    >
      <Show
        when={access()}
        fallback={<RedirectSplit to={{ type: 'component', id: 'home' }} />}
      >
        <TrackedPartnersView />
      </Show>
    </Show>
  );
}, LoadingBlock);
