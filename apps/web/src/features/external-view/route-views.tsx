import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate, useRouteParams } from '@app/lib/split-router';
import {
  externalRoute,
  externalWhatsappGroupRoute,
  homeSplitRoute,
} from '@app/routes/routes';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import { Button } from '@ui';
import { lazy, onMount, Show } from 'solid-js';
import { ExternalViewSkeleton } from './external-view-skeleton';

const ExternalView = lazy(async () => ({
  default: (await import('./external-view')).ExternalView,
}));

function DisabledExternalRoute() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: homeSplitRoute, params: {} }, { replace: true })
  );
  return null;
}

function TrackedExternalView() {
  usePageViewTracking('external');
  return <ExternalView />;
}

/** `/external`; a deep link with the flag off goes Home once the flag resolves. */
export const ExternalRouteView = withAuth(() => {
  const flag = useFeatureFlag(enableWhatsappLinked);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<ExternalViewSkeleton />}>
          <DisabledExternalRoute />
        </Show>
      }
    >
      <TrackedExternalView />
    </Show>
  );
}, ExternalViewSkeleton);

const WhatsAppGroupEntry = lazy(async () => ({
  default: (await import('../whatsapp-group/whatsapp-group-entry'))
    .WhatsAppGroupEntry,
}));

/** Touch drills into a group full-screen; Back returns to External's list. */
function BackToExternal() {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Back to WhatsApp"
      tooltip="Back to WhatsApp"
      class="shrink-0"
      onClick={() =>
        fireAndForget(
          navigate({ route: externalRoute, params: {} }),
          'external-view'
        )
      }
    >
      <CaretLeftIcon />
    </Button>
  );
}

/** `/external/whatsapp/:groupId`: a group in External's main pane. */
export function ExternalWhatsAppGroupRouteView() {
  const params = useRouteParams(externalWhatsappGroupRoute);
  usePageViewTracking('whatsapp-group');
  return (
    <WhatsAppGroupEntry
      groupId={params.groupId}
      leading={isTouchDevice() ? <BackToExternal /> : undefined}
    />
  );
}
