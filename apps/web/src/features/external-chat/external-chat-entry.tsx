import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import { homeSplitRoute } from '@app/routes/routes';
import { ChannelLoading } from '@channel/Channel/ChannelLoading';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { type JSX, lazy, onMount, Show, Suspense } from 'solid-js';
import { ExternalChatHeader } from './components/chat-header';

const Chat = lazy(async () => ({
  default: (await import('./external-chat')).ExternalChat,
}));
/** The chat's header (badge, name, Share, details toggle) over Chat's loading rows. */
export function ExternalChatSkeleton(props: { leading?: JSX.Element } = {}) {
  return (
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-panel touch:pt-(--mobile-content-inset-top)">
      <ExternalChatHeader
        title="Chat"
        leading={props.leading}
        share={<ViewSkeleton.Control control="Share" />}
        details={<ViewSkeleton.Control control={1} />}
      />
      <div class="flex min-h-0 flex-1 flex-col touch:[--mobile-content-inset-top:0px]">
        <ChannelLoading />
      </div>
    </div>
  );
}
function DisabledChat() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: homeSplitRoute, params: {} }, { replace: true })
  );
  return null;
}
/** Gate before mounting any queries, including panes restored from session state. */
export function ExternalChatEntry(props: {
  chatId: string;
  leading?: JSX.Element;
}) {
  const flag = useFeatureFlag(enableWhatsappLinked);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show
          when={!flag().loading}
          fallback={<ExternalChatSkeleton leading={props.leading} />}
        >
          <DisabledChat />
        </Show>
      }
    >
      <Suspense fallback={<ExternalChatSkeleton leading={props.leading} />}>
        <Chat chatId={props.chatId} leading={props.leading} />
      </Suspense>
    </Show>
  );
}
