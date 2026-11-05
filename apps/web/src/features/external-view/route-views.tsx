import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate, useRouteParams } from '@app/lib/split-router';
import { externalChatRoute, externalRoute } from '@app/routes/routes';
import { defaultViewContent } from '@components/app/sidebar-next/default-view';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import { Button } from '@ui';
import { lazy, Show } from 'solid-js';
import { ExternalViewSkeleton } from './external-view-skeleton';

const ExternalView = lazy(async () => ({
  default: (await import('./external-view')).ExternalView,
}));

function TrackedExternalView() {
  usePageViewTracking('external');
  return <ExternalView />;
}

/** `/external`; a deep link with the flag off goes to the default view once the flag resolves. */
export const ExternalRouteView = withAuth(() => {
  const flag = useFeatureFlag(enableWhatsappLinked);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<ExternalViewSkeleton />}>
          <RedirectSplit to={defaultViewContent()} />
        </Show>
      }
    >
      <TrackedExternalView />
    </Show>
  );
}, ExternalViewSkeleton);

const ExternalChatEntry = lazy(async () => ({
  default: (await import('../external-chat/external-chat-entry'))
    .ExternalChatEntry,
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
