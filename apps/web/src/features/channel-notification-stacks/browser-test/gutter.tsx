// The channel gutter's checks and list over synthetic notifications, in a
// pane whose width the test sets; no network. Marking applies at once, as the
// notification source's local overrides do.
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import {
  type ThreadGutter,
  ThreadGutterSlot,
} from '@channel/Thread/ThreadGutterSlot';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { UnifiedNotification } from '@notifications/types';
import type { NotifEvent } from '@service-notification/generated/schemas';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  ChannelStack,
  NotificationListView,
  StackListStatus,
} from '../core/channel-stacks';
import { createChannelNotificationStacks } from '../primitives/channel-notification-stacks';
import { NotificationList } from '../views/notification-list';
import { stackChecksGutter } from '../views/stack-checks';
import '@fontsource-variable/inter';
import '../../../index.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme(params.get('theme') === 'light' ? 'Macro Light' : 'Macro Dark');

const NAMES: Record<string, string> = { ana: 'Ana', leo: 'Leo', mara: 'Mara' };

function notification(
  id: string,
  minute: number,
  sender: string,
  state: UnifiedNotification['state'],
  metadata: NotifEvent
): UnifiedNotification {
  const at = new Date(Date.UTC(2026, 10, 18, 10, minute)).toISOString();
  return {
    id,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: at,
    updated_at: at,
    viewed_at: null,
    deleted_at: null,
    state,
    sent: true,
    sender_id: sender,
    notification_event_type: metadata.tag,
    notification_metadata: metadata,
  };
}

// Three stacks: two new top-level messages (one already seen), a thread with
// a reply, and a top-level mention.
const NOTIFICATIONS: UnifiedNotification[] = [
  notification('n1', 1, 'ana', 'seen', {
    tag: 'channel_message_send',
    content: { messageId: 'm1', messageContent: '', channelType: 'public' },
  }),
  notification('n2', 2, 'leo', 'unseen', {
    tag: 'channel_message_send',
    content: { messageId: 'm2', messageContent: '', channelType: 'public' },
  }),
  notification('n3', 4, 'mara', 'unseen', {
    tag: 'channel_message_reply',
    content: {
      messageId: 'r1',
      threadId: 'm3',
      messageContent: '',
      userId: 'mara',
      channelType: 'public',
    },
  }),
  notification('n4', 5, 'leo', 'seen', {
    tag: 'channel_mention',
    content: {
      messageId: 'm4',
      threadId: null,
      messageContent: '',
      channelType: 'public',
    },
  }),
];

type Row = {
  id: string;
  text: string;
  replies?: { id: string; text: string }[];
};
const ROWS: Row[] = [
  { id: 'm1', text: 'Shipping the release notes today.' },
  { id: 'm2', text: 'I can take the review this afternoon.' },
  {
    id: 'm3',
    text: 'Who owns the flaky deploy check?',
    replies: [{ id: 'r1', text: 'I will look into it after lunch.' }],
  },
  { id: 'm4', text: 'Can you confirm the numbers before standup?' },
];

declare global {
  interface Window {
    resizeGutterPane: (width: number) => void;
    /** Messages the channel was asked to scroll to, as `thread/reply`. */
    opened: string[];
    /** Notification ids marked done or read, in order. */
    marked: { kind: 'done' | 'read'; ids: string[] }[];
    /** A new unseen message notification from Ana. */
    notify: (id: string, messageId: string) => void;
  }
}
window.opened = [];
window.marked = [];

function Fixture() {
  const [width, setWidth] = createSignal(Number(params.get('pane') ?? '1600'));
  window.resizeGutterPane = setWidth;
  // `?empty` starts with nothing left to mark done.
  const [records, setRecords] = createSignal(
    params.has('empty') ? [] : NOTIFICATIONS
  );
  const [open, setOpen] = createSignal(true);
  const [view, setView] = createSignal<NotificationListView>('not_done');
  // `?notDone=failed` starts as if the not-done read failed; Retry loads it.
  const [notDoneStatus, setNotDoneStatus] = createSignal<StackListStatus>(
    params.get('notDone') === 'failed'
      ? 'failed'
      : params.get('notDone') === 'loading'
        ? 'loading'
        : 'ready'
  );

  const stacks = createChannelNotificationStacks({
    // Like the not-done read: nothing until it has loaded.
    active: () => (notDoneStatus() === 'ready' ? records() : undefined),
    unread: records,
  });
  const mark = (kind: 'done' | 'read', marked: readonly ChannelStack[]) => {
    const ids = new Set(
      marked.flatMap((stack) => stack.notifications.map((n) => n.id))
    );
    window.marked.push({ kind, ids: [...ids] });
    setRecords((current) =>
      current.map((n) =>
        ids.has(n.id) ? { ...n, state: kind === 'done' ? 'done' : 'seen' } : n
      )
    );
  };
  window.notify = (id, messageId) =>
    setRecords((current) => [
      ...current,
      notification(id, 10 + current.length, 'ana', 'unseen', {
        tag: 'channel_message_send',
        content: { messageId, messageContent: '', channelType: 'public' },
      }),
    ]);
  // One gutter per thread, as the channel keeps them.
  const gutters = new Map<string, ThreadGutter>();
  const gutterFor = (rootId: string) => {
    if (!stacks.notDoneByThread().has(rootId)) return;
    let gutter = gutters.get(rootId);
    if (!gutter) {
      gutter = stackChecksGutter({
        stacks: () => stacks.notDoneByThread().get(rootId),
        senderName: (id) => NAMES[id],
        onDone: (stack) => mark('done', [stack]),
      });
      gutters.set(rootId, gutter);
    }
    return gutter;
  };

  let pane!: HTMLDivElement;
  const [paneEl, setPaneEl] = createSignal<HTMLElement>();
  const paneSize = createElementSize(paneEl);

  return (
    <div
      ref={(el) => {
        pane = el;
        setPaneEl(el);
      }}
      data-pane
      class="@container/channel-pane relative h-screen overflow-hidden bg-panel text-ink"
      style={{ width: `${width()}px` }}
    >
      <div class="mx-auto flex macro-message-width flex-col pt-14">
        <For each={ROWS}>
          {(row) => {
            const gutter = () => gutterFor(row.id);
            return (
              <div data-message={row.id} class="relative">
                <div class="relative px-3 pt-(--regular-message-padding-t) pb-1 text-sm">
                  <Show when={gutter()}>
                    {(g) => (
                      <ThreadGutterSlot>
                        {g().root(() =>
                          (row.replies ?? []).map((reply) => reply.id)
                        )}
                      </ThreadGutterSlot>
                    )}
                  </Show>
                  {row.text}
                </div>
                <div style={{ '--thread-gutter-inset': '32px' }} class="pl-8">
                  <For each={row.replies ?? []}>
                    {(reply) => (
                      <div
                        data-message={reply.id}
                        class="relative px-3 pt-(--regular-message-padding-t) pb-1 text-sm"
                      >
                        <Show when={gutter()}>
                          {(g) => (
                            <ThreadGutterSlot>
                              {g().reply(reply.id)}
                            </ThreadGutterSlot>
                          )}
                        </Show>
                        {reply.text}
                      </div>
                    )}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </div>
      <NotificationList
        gutterWidth={() =>
          Math.max(0, ((paneSize.width ?? pane?.clientWidth ?? 0) - 920) / 2)
        }
        open={open}
        onOpenChange={setOpen}
        view={view}
        onViewChange={setView}
        notDone={stacks.notDone}
        unread={stacks.unread}
        status={(listView) =>
          listView === 'not_done' ? notDoneStatus() : 'ready'
        }
        onRetry={() => {
          // The retry's answer arrives a moment later.
          setNotDoneStatus('retrying');
          setTimeout(() => setNotDoneStatus('ready'), 300);
        }}
        senderName={(id) => NAMES[id]}
        onOpenStack={(stack) =>
          window.opened.push(
            [stack.anchor.threadId, stack.anchor.messageId]
              .filter(Boolean)
              .join('/')
          )
        }
        onMarkDone={(marked) => mark('done', marked)}
        onMarkRead={(marked) => mark('read', marked)}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
