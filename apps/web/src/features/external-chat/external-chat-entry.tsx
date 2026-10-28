import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import { homeSplitRoute } from '@app/routes/routes';
import { ChannelLoading } from '@channel/Channel/ChannelLoading';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { type JSX, lazy, onMount, Show, Suspense } from 'solid-js';

const Chat = lazy(async () => ({
  default: (await import('./external-chat')).ExternalChat,
}));
/** The chat's header (badge, name, Share, details toggle) over Chat's loading rows. */
export function ExternalChatSkeleton() {
  return (
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-panel">
      <div
        aria-hidden="true"
        class="flex h-12 shrink-0 items-center gap-2 px-3 touch:h-auto touch:min-h-12 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.75rem)]"
      >
        <ListSkeleton.Bar class="size-5 shrink-0" />
        <ListSkeleton.Bar class="w-32" />
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <ViewSkeleton.Control control="Share" />
          <ViewSkeleton.Control control={1} />
        </div>
      </div>
      {/* The header above already clears the top inset. */}
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
        <Show when={!flag().loading} fallback={<ExternalChatSkeleton />}>
          <DisabledChat />
        </Show>
      }
    >
      <Suspense fallback={<ExternalChatSkeleton />}>
        <Chat chatId={props.chatId} leading={props.leading} />
      </Suspense>
    </Show>
  );
}
