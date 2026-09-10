import { ChannelInput, type InputHandle } from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { buildMessageLink } from '@channel/Thread/utils/message-actions';
import { useMessageBotMentionUsers } from '@channel/use-channel-bot-mention-users';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import {
  useChannelReferenceThreadsQuery,
  useMessageLink,
} from '@queries/messages';
import { useSendMessageMutation } from '@queries/messages/mutations';
import { useMessageTimelineQuery } from '@queries/messages/timeline';
import type { MessageParent } from '@service-storage/messages';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { MessageThread, MessageThreadFromSource } from './MessageThread';
import type { MessageData } from './types';

export function DocumentConversation(props: {
  parent: MessageParent;
  canWrite: boolean;
  canManage?: boolean;
  targetId?: string | null;
  buildLink?: (message: MessageData) => string;
  label?: string;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const [includeReferences, setIncludeReferences] = createSignal(false);
  const target = useMessageLink(
    () => props.parent,
    () => props.targetId
  );
  const query = useMessageTimelineQuery(() => props.parent, target.messageId);
  const references = useChannelReferenceThreadsQuery(
    () => props.parent,
    includeReferences
  );
  const send = useSendMessageMutation();
  const userId = useUserId();
  const bots = useMessageBotMentionUsers(() => props.parent);
  let input: InputHandle | undefined;
  const messages = () =>
    query.isSuccess
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
  const sourcesById = createMemo(
    () =>
      new Map(
        (references.isSuccess ? references.data : []).map((item) => [
          item.root_id,
          item,
        ])
      )
  );
  return (
    <section class="mt-3 pb-12" data-document-conversation>
      <button
        type="button"
        class="text-xs"
        onClick={() => setExpanded(!expanded())}
      >
        {expanded() ? '▾' : '▸'} {props.label ?? 'Discussion'}
      </button>
      <Show when={expanded() || props.targetId}>
        <label class="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={includeReferences()}
            onChange={(event) =>
              setIncludeReferences(event.currentTarget.checked)
            }
          />
          Include channel mentions
        </label>
        <StaticMarkdownContext>
          <Show when={query.isPending}>
            <p class="text-xs text-ink-muted">Loading comments...</p>
          </Show>
          <Show when={query.isError}>
            <button onClick={() => void query.refetch()}>
              Could not load comments. Retry
            </button>
          </Show>
          <Show when={query.hasNextPage}>
            <button class="text-xs" onClick={() => void query.fetchNextPage()}>
              Load earlier comments
            </button>
          </Show>
          <For each={[...messagesById().keys()]}>
            {(id) => (
              <MessageThread
                data={messagesById().get(id)!}
                canWrite={props.canWrite}
                canManage={props.canManage}
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
          <Show when={includeReferences()}>
            <Show when={references.isError}>
              <button onClick={() => void references.refetch()}>
                Could not load channel mentions. Retry
              </button>
            </Show>
            <For each={[...sourcesById().keys()]}>
              {(id) => {
                const item = () => sourcesById().get(id)!;
                return (
                  <div data-source-channel-thread>
                    <a
                      class="text-xs text-ink-muted underline"
                      href={buildMessageLink(item().parent.id, item().root_id)}
                    >
                      From {item().channel_name || 'Channel conversation'}
                    </a>
                    <MessageThreadFromSource
                      parent={item().parent}
                      rootId={item().root_id}
                      canWrite={item().can_reply}
                      expanded={false}
                    />
                  </div>
                );
              }}
            </For>
          </Show>
          <Show when={props.canWrite}>
            <div class="mt-4">
              <ChannelInput
                parent={props.parent}
                bots={bots}
                input={{ mode: 'channel', placeholder: 'Leave a comment...' }}
                autofocus={false}
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
                }}
              />
            </div>
          </Show>
        </StaticMarkdownContext>
      </Show>
    </section>
  );
}
