import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate, useRouteParams } from '@app/lib/split-router';
import {
  externalChatRoute,
  externalRoute,
  homeSplitRoute,
} from '@app/routes/routes';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import { Button } from '@ui';
import { onMount, Show } from 'solid-js';
import { ExternalChatEntry } from '../external-chat/external-chat-entry';
import { ExternalView } from './external-view';
import { ExternalViewSkeleton } from './external-view-skeleton';

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
      <CaretLeftIcon class="size-3.5 touch:size-6" />
    </Button>
  );
}

/** `/external/chat/:chatId`: an added chat in External's main pane. */
export function ExternalChatRouteView() {
  const params = useRouteParams(externalChatRoute);
  usePageViewTracking('external-chat');
  return (
    <ExternalChatEntry
      chatId={params.chatId}
      leading={isTouchDevice() ? <BackToExternal /> : undefined}
    />
  );
}
