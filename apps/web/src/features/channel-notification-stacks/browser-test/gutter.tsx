// The channel gutter's list over synthetic notifications, in a pane whose
// width the test sets; no network. Marking applies at once, as the
// notification source's local overrides do.
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { UnifiedNotification } from '@notifications/types';
import type { NotifEvent } from '@service-notification/generated/schemas';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { StackListStatus } from '../core/channel-stacks';
import { createChannelNotificationStacks } from '../primitives/channel-notification-stacks';
import { createChannelVisit } from '../primitives/channel-visits';
import { NotificationList } from '../views/notification-list';
import '@fontsource-variable/inter';
import '../../../index.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme(params.get('theme') === 'light' ? 'Macro Light' : 'Macro Dark');

// `?names=long` gives senders long unbroken addresses and a long multi-word
// name, to check the list's rows wrap them inside the card.
const NAMES: Record<string, string> =
  params.get('names') === 'long'
    ? {
        ana: 'quarterly.release.coordination.team@synthetic-example-workspace.test',
        leo: 'Leopold Maximilian Fairweather-Huntington of the Northern Planning Office',
        mara: 'm.okonkwo-reyes.design@synthetic-example.test',
      }
    : { ana: 'Ana', leo: 'Leo', mara: 'Mara' };

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

// Three unread stacks: new top-level messages (one of the two already seen, so
// not listed but marked with its stack), a thread with a reply, and a
// top-level mention.
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
  notification('n4', 5, 'leo', 'unseen', {
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

type Arrival = 'message' | 'reply' | 'mention';

declare global {
  interface Window {
    resizeGutterPane: (width: number) => void;
    /** Messages the channel was asked to scroll to, as `thread/reply`. */
    opened: string[];
    /** Notification ids marked done, in order, and whether it worked. */
    marked: { ids: string[]; ok: boolean }[];
    /** The next mark done fails, a moment later. */
    failNextMark: boolean;
    /** A new unseen notification from Ana, in thread `m3` for a reply. */
    notify: (id: string, kind: Arrival) => void;
    /** Read notifications, as scrolling past their messages does. */
    read: (ids: string[]) => void;
    /** Leave the channel, and open it again a few seconds later. */
    reopen: () => Promise<void>;
    /** Mount the channel again at once, as moving its split does. */
    remount: () => void;
  }
}
window.opened = [];
window.marked = [];
window.failNextMark = false;

const ARRIVALS: Record<Arrival, (id: string) => NotifEvent> = {
  message: (id) => ({
    tag: 'channel_message_send',
    content: {
      messageId: `m-${id}`,
      messageContent: '',
      channelType: 'public',
    },
  }),
  reply: (id) => ({
    tag: 'channel_message_reply',
    content: {
      messageId: `r-${id}`,
      threadId: 'm3',
      messageContent: '',
      userId: 'ana',
      channelType: 'public',
    },
  }),
  mention: (id) => ({
    tag: 'channel_mention',
    content: {
      messageId: `m-${id}`,
      threadId: null,
      messageContent: '',
      channelType: 'public',
    },
  }),
};

function initialStatus(name: string): StackListStatus {
  const value = params.get(name);
  return value === 'failed' || value === 'loading' ? value : 'ready';
}

// Notifications outlive a channel, as the server's do.
// `?openedFromRow` opens the channel as a Home row does: the row's click has
// just read the new messages and the thread.
const OPENED_FROM_ROW = params.has('openedFromRow');
const [records, setRecords] = createSignal(
  params.has('empty')
    ? []
    : NOTIFICATIONS.map((n) =>
        OPENED_FROM_ROW && (n.id === 'n2' || n.id === 'n3')
          ? {
              ...n,
              state: 'seen' as const,
              viewed_at: new Date().toISOString(),
            }
          : n
      )
);
window.notify = (id, kind) =>
  setRecords((current) => [
    ...current,
    notification(id, 10 + current.length, 'ana', 'unseen', ARRIVALS[kind](id)),
  ]);
window.read = (ids) =>
  setRecords((current) =>
    current.map((n) =>
      ids.includes(n.id) && n.state === 'unseen'
        ? { ...n, state: 'seen', viewed_at: new Date().toISOString() }
        : n
    )
  );

/** One open channel: its list gathers from the moment it mounts. */
function Channel(props: { width: number }) {
  // `?notDone=failed|loading` starts as if the not-done read failed or loads.
  const [status, setStatus] = createSignal(initialStatus('notDone'));
  const [open, setOpen] = createSignal(true);

  const stacks = createChannelNotificationStacks({
    // Like the not-done read: nothing until it has answered.
    notDone: () => (status() === 'ready' ? records() : undefined),
    settled: () => status() === 'ready',
    complete: () => true,
    readAt: (n) => n.viewed_at ?? undefined,
    unreadSince: createChannelVisit('channel-1'),
    markDone: async (_stacks, notifications) => {
      const ids = notifications.map((n) => n.id);
      if (window.failNextMark) {
        window.failNextMark = false;
        await new Promise((resolve) => setTimeout(resolve, 300));
        window.marked.push({ ids, ok: false });
        return false;
      }
      window.marked.push({ ids, ok: true });
      setRecords((current) =>
        current.map((n) => (ids.includes(n.id) ? { ...n, state: 'done' } : n))
      );
      return true;
    },
  });

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
      class="relative h-screen overflow-hidden bg-panel text-ink"
      style={{ width: `${props.width}px` }}
    >
      <div class="mx-auto flex macro-message-width flex-col pt-14">
        <For each={ROWS}>
          {(row) => (
            <div data-message={row.id} class="relative">
              <div class="relative px-3 pt-(--regular-message-padding-t) pb-1 text-sm">
                {row.text}
              </div>
              <div class="pl-8">
                <For each={row.replies ?? []}>
                  {(reply) => (
                    <div
                      data-message={reply.id}
                      class="relative px-3 pt-(--regular-message-padding-t) pb-1 text-sm"
                    >
                      {reply.text}
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
      <NotificationList
        gutterWidth={() =>
          Math.max(0, ((paneSize.width ?? pane?.clientWidth ?? 0) - 920) / 2)
        }
        open={open}
        onOpenChange={setOpen}
        stacks={stacks.listed}
        status={status}
        onRetry={() => {
          // The retry's answer arrives a moment later.
          setStatus('retrying');
          setTimeout(() => setStatus('ready'), 300);
        }}
        senderName={(id) => NAMES[id]}
        onOpenStack={(stack) =>
          window.opened.push(
            [stack.anchor.threadId, stack.anchor.messageId]
              .filter(Boolean)
              .join('/')
          )
        }
        onMarkDone={(marked) =>
          fireAndForget(stacks.markDone(marked), 'gutter-fixture')
        }
      />
    </div>
  );
}

function Fixture() {
  const [width, setWidth] = createSignal(Number(params.get('pane') ?? '1600'));
  window.resizeGutterPane = setWidth;
  // 0 while the channel is closed; a new number mounts it anew.
  const [visit, setVisit] = createSignal(1);
  let visits = 1;
  window.remount = () => setVisit(++visits);
  window.reopen = async () => {
    setVisit(0);
    // Longer than a remount, so it counts as leaving.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    setVisit(++visits);
  };

  return (
    <Show when={visit()} keyed>
      {(count) => (
        <div data-visit={count}>
          <Channel width={width()} />
        </div>
      )}
    </Show>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
