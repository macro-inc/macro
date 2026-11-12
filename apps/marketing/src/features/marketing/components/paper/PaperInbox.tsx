import { For, type JSX, Show } from 'solid-js';
import './paper-inbox.css';

export type PaperInboxRow = {
  /** A channel name without its hash, or a person for a direct message or email. */
  source: string;
  kind: 'channel' | 'person';
  sender?: string;
  preview: string;
  time: string;
  state?: 'unread' | 'later' | 'done';
};

function RowIcon(props: { row: PaperInboxRow }) {
  return (
    <Show
      when={props.row.kind === 'channel'}
      fallback={<span class="paper-inbox-avatar">{props.row.source[0]}</span>}
    >
      <span class="paper-inbox-hash">#</span>
    </Show>
  );
}

/** One column of inbox rows under a labelled tab, in the app's inbox style. */
export function PaperInboxList(props: {
  label: string;
  count: number;
  rows: readonly PaperInboxRow[];
  muted?: boolean;
  footer?: JSX.Element;
}) {
  return (
    <div class="paper-inbox-list paper-feature-glass" data-muted={props.muted}>
      <div class="paper-inbox-head">
        <strong>{props.label}</strong>
        <span>{props.count}</span>
      </div>
      <For each={props.rows}>
        {(row) => (
          <div class="paper-inbox-row" data-state={row.state}>
            <RowIcon row={row} />
            <div class="paper-inbox-text">
              <div>
                <strong>{row.source}</strong>
                <Show when={row.sender}>
                  <span>{row.sender}</span>
                </Show>
              </div>
              <p>{row.preview}</p>
            </div>
            <Show
              when={row.state === 'later' || row.state === 'done'}
              fallback={<span class="paper-inbox-time">{row.time}</span>}
            >
              <span class="paper-inbox-pill" data-state={row.state}>
                {row.state === 'done' ? 'Done' : row.time}
              </span>
            </Show>
          </div>
        )}
      </For>
      {props.footer}
    </div>
  );
}

const chatRows: PaperInboxRow[] = [
  {
    source: 'bug-reports',
    kind: 'channel',
    sender: 'Rahul Batra',
    preview: 'Checkout is failing on Safari 17 again',
    time: '9:41 AM',
    state: 'unread',
  },
  {
    source: 'launch',
    kind: 'channel',
    sender: 'Julia Westphal',
    preview: 'Can you review the pricing copy?',
    time: '9:20 AM',
    state: 'unread',
  },
  {
    source: 'Teo Nys',
    kind: 'person',
    preview: 'Sent you the notes from the customer call',
    time: 'Tomorrow 9 AM',
    state: 'later',
  },
  {
    source: 'design',
    kind: 'channel',
    sender: 'Eric Hayes',
    preview: 'Mockups are in the folder',
    time: '8:52 AM',
    state: 'done',
  },
];

/** Channel messages waiting in an inbox: unread, saved for later, and done. */
export function PaperChatInbox() {
  return (
    <div class="paper-inbox">
      <PaperInboxList
        label="Inbox"
        count={3}
        rows={chatRows}
        footer={
          <div class="paper-inbox-keys">
            <kbd>J</kbd>
            <kbd>K</kbd>
            <span>Move</span>
            <kbd>E</kbd>
            <span>Mark done</span>
          </div>
        }
      />
    </div>
  );
}

const signalRows: PaperInboxRow[] = [
  {
    source: 'Austin Barron',
    kind: 'person',
    preview: 'Thursday at 9 works. Could you send the setup plan?',
    time: '9:41 AM',
    state: 'unread',
  },
  {
    source: 'Julia Westphal',
    kind: 'person',
    preview: 'Can you check the draft before I send it?',
    time: '9:32 AM',
    state: 'unread',
  },
  {
    source: 'Teo Nys',
    kind: 'person',
    preview: 'Here are the notes from this morning',
    time: '9:18 AM',
  },
];

const noiseRows: PaperInboxRow[] = [
  {
    source: 'Product updates',
    kind: 'person',
    preview: 'See what’s new this month',
    time: '9:02 AM',
  },
  {
    source: 'Receipts',
    kind: 'person',
    preview: 'Your invoice for November is ready',
    time: '8:40 AM',
  },
  {
    source: 'Weekly digest',
    kind: 'person',
    preview: '12 stories picked for you',
    time: '7:15 AM',
  },
];

/** Important email in Signal beside newsletters and receipts in Noise. */
export function PaperEmailSignalNoise() {
  return (
    <div class="paper-inbox paper-inbox-split">
      <PaperInboxList label="Signal" count={3} rows={signalRows} />
      <PaperInboxList label="Noise" count={12} rows={noiseRows} muted />
    </div>
  );
}
