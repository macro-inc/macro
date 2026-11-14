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
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import { useExternalChatDetailQuery } from '@queries/external-chats';
import { Button } from '@ui';
import { onMount, Show } from 'solid-js';
import { ExternalChatEntry } from '../external-chat/external-chat-entry';
import { providerIdentity } from '../external-chat/providers/identity';
import { externalChatApi } from '../external-chat/queries/production-api';
import { ExternalView } from './external-view';
import { ExternalViewSkeleton } from './external-view-skeleton';
import { useEnabledProviders } from './provider-flags';

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

/**
 * `/external`, while any provider's flag is on; a deep link with every flag
 * off goes Home once the flags resolve.
 */
export const ExternalRouteView = withAuth(() => {
  const enabled = useEnabledProviders();
  return (
    <Show
      when={enabled().providers.length > 0}
      fallback={
        <Show when={!enabled().loading} fallback={<ExternalViewSkeleton />}>
          <DisabledExternalRoute />
        </Show>
      }
    >
      <TrackedExternalView />
    </Show>
  );
}, ExternalViewSkeleton);

/**
 * Touch drills into a chat full-screen; Back returns to External's list,
 * named after the chat's provider once its detail loads.
 */
function BackToExternal(props: { chatId: string }) {
  const navigate = useNavigate();
  const userId = useUserId();
  const chat = useExternalChatDetailQuery(
    externalChatApi,
    () => userId() ?? '',
    () => props.chatId
  );
  const provider = () => chat.data?.provider;
  const backState = () => {
    const known = provider();
    return known ? { provider: known } : undefined;
  };
  const label = () => {
    const known = provider();
    return known ? `Back to ${providerIdentity(known).label}` : 'Back';
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label()}
      tooltip={label()}
      class="shrink-0"
      onClick={() =>
        fireAndForget(
          navigate(
            { route: externalRoute, params: {} },
            // Back to the chat's provider page.
            { state: backState() }
          ),
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
      leading={
        isTouchDevice() ? <BackToExternal chatId={params.chatId} /> : undefined
      }
    />
  );
}
