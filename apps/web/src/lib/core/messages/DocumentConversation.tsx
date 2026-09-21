import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { navigateToChannelMessage } from '@block-channel/utils/link';
import { ChannelInput, type InputHandle } from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { useMessageBotMentionUsers } from '@channel/use-channel-bot-mention-users';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { InlineItemPreview } from '@core/component/ItemPreview';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableDocumentChannelMentions } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { useContacts } from '@queries/contacts/contacts';
import { useMessageLink } from '@queries/messages/document-messages';
import { useSendMessageMutation } from '@queries/messages/mutations';
import { useChannelReferenceThreadsQuery } from '@queries/messages/references';
import { useMessageTimelineQuery } from '@queries/messages/timeline';
import type { MessageParent } from '@service-storage/messages';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { MessageThread, MessageThreadFromSource } from './MessageThread';
import type { MessageData } from './types';

/** The root composer, inline below the roots or floating on touch devices. */
export function DocumentConversationComposer(props: {
  parent: MessageParent;
  collapsible?: boolean;
  /** Dismiss the keyboard after submitting from a floating mobile composer. */
  blurOnSend?: boolean;
}) {
  const send = useSendMessageMutation();
  const userId = useUserId();
  const bots = useMessageBotMentionUsers(() => props.parent);
  // Workspace users for @-mentions, matching the legacy comment composer's
  // global mention source; ChannelInput otherwise offers only agents and bots.
  const participants = useContacts();
  let input: InputHandle | undefined;
  return (
    <ChannelInput
      parent={props.parent}
      bots={bots}
      participants={participants}
      input={{ mode: 'channel', placeholder: 'Leave a comment...' }}
      autofocus={false}
      collapsible={props.collapsible}
      onReady={(handle) => (input = handle)}
      onSend={async (snapshot) => {
        const senderId = userId();
        if (!senderId) return;
        await send.mutateAsync({
          parent: props.parent,
          senderId,
          optimisticId: crypto.randomUUID(),
          ...buildPostMessageSendPayload({ snapshot }),
        });
        input?.clear();
        if (props.blurOnSend && document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
      }}
    />
  );
}

export function DocumentConversation(props: {
  parent: MessageParent;
  canWrite: boolean;
  targetId?: string | null;
  buildLink?: (message: MessageData) => string;
  label?: string;
  /** The composer is rendered elsewhere, such as a floating mobile accessory. */
  hideComposer?: boolean;
  /** Render nothing while there is no root to show. */
  hideWhenEmpty?: boolean;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const orchestrator = useGlobalBlockOrchestrator();
  const mentions = useFeatureFlag(enableDocumentChannelMentions);
  // Discovery fetches on open and polls while shown, so it stays off the wire
  // entirely until the flag is on for this viewer.
  const references = useChannelReferenceThreadsQuery(
    () => props.parent,
    () => mentions().enabled
  );
  const target = useMessageLink(
    () => props.parent,
    () => props.targetId
  );
  // A copied link may name a reply or an anchored root; the window is a root window.
  const query = useMessageTimelineQuery(
    () => props.parent,
    target.rootId,
    target.resolved
  );
  // Until the link resolves, the shared latest page would flash before the window jumps.
  const messages = () =>
    target.resolved() && query.isSuccess
      ? query.data.pages
          .flatMap((page) => page.items)
          // Only known unanchored roots belong in Discussion. Live roots have
          // undefined anchors until their thread metadata is fetched.
          .filter(
            (message) =>
              !message.state.deleted_at && message.state.anchor === null
          )
          .toReversed()
      : [];
  const messagesById = createMemo(
    () => new Map(messages().map((message) => [message.id, message]))
  );
  // Keyed by root so a refreshed list keeps each source thread's drafts and
  // focus; a failed refetch keeps the last authorized list rather than
  // unmounting the threads.
  const sourcesById = createMemo(
    () =>
      new Map(
        (mentions().enabled && !references.isPending
          ? (references.data ?? [])
          : []
        ).map((item) => [item.root_id, item])
      )
  );
  return (
    <Show when={!props.hideWhenEmpty || messages().length > 0}>
      <section class="mt-3 pb-12" data-document-conversation>
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs font-medium text-ink-muted not-touch:hover:text-ink"
          onClick={() => setExpanded(!expanded())}
        >
          <CaretRightIcon
            class="size-3 transition-transform duration-90"
            classList={{ 'rotate-90': expanded() }}
          />
          {props.label ?? 'Discussion'}
        </button>
        <Show when={expanded() || props.targetId}>
          <StaticMarkdownContext>
            <Show when={!target.resolved() || query.isPending}>
              <p class="text-xs text-ink-muted">Loading comments...</p>
            </Show>
            <Show when={query.isError}>
              <button onClick={() => void query.refetch()}>
                Could not load comments. Retry
              </button>
            </Show>
            <Show when={query.hasNextPage}>
              <button
                class="text-xs"
                onClick={() => void query.fetchNextPage()}
              >
                Load earlier comments
              </button>
            </Show>
            <For each={[...messagesById().keys()]}>
              {(id) => (
                <MessageThread
                  data={messagesById().get(id)!}
                  canWrite={props.canWrite}
                  targetId={target.rootId() === id ? target.messageId() : null}
                  buildLink={props.buildLink}
                />
              )}
            </For>
            <Show when={query.hasPreviousPage}>
              <button
                class="text-xs"
                onClick={() => void query.fetchPreviousPage()}
              >
                Load newer comments
              </button>
            </Show>
            <Show when={mentions().enabled}>
              <Show when={references.isError}>
                <button onClick={() => void references.refetch()}>
                  Could not load channel mentions. Retry
                </button>
              </Show>
              <Show when={sourcesById().size > 0}>
                <div class="mt-5 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                  Channel mentions
                  <span class="text-ink-extra-muted tabular-nums">
                    {sourcesById().size}
                  </span>
                </div>
              </Show>
              <For each={[...sourcesById().keys()]}>
                {(id) => {
                  const item = () => sourcesById().get(id)!;
                  return (
                    <div class="mt-4" data-source-channel-thread={id}>
                      {/* The channel resolves its own current name, so an
                          unnamed channel or a DM reads as its participants
                          rather than a placeholder. */}
                      <button
                        type="button"
                        class="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-ink-muted not-touch:hover:text-ink"
                        onClick={() =>
                          navigateToChannelMessage(
                            orchestrator,
                            item().parent.id,
                            item().root_id
                          )
                        }
                      >
                        <span class="shrink-0 text-ink-muted/70">From</span>
                        <InlineItemPreview
                          id={item().parent.id}
                          type="channel"
                        />
                      </button>
                      <MessageThreadFromSource
                        parent={item().parent}
                        rootId={item().root_id}
                        canWrite={item().can_reply}
                      />
                    </div>
                  );
                }}
              </For>
            </Show>
            <Show when={props.canWrite && !props.hideComposer}>
              <div class="mt-4">
                <DocumentConversationComposer parent={props.parent} />
              </div>
            </Show>
          </StaticMarkdownContext>
        </Show>
      </section>
    </Show>
  );
}
