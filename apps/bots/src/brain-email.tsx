import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  type BrainEmailInbox,
  type BrainEmailReader,
  type BrainEmailScope,
  type BrainEmailThread,
  type BrainEmailThreadSummary,
  filterBrainEmailThreads,
  selectBrainEmailThread,
} from './brain-email-reader';
import './brain-email.css';

type ProvisionedEmail = Extract<BrainEmailInbox, { status: 'provisioned' }> &
  Readonly<{
    readThread: (
      id: string,
      signal: AbortSignal
    ) => Promise<BrainEmailThread | undefined>;
  }>;

export type BrainEmailMailbox =
  | ProvisionedEmail
  | Readonly<{ status: 'loading' | 'unavailable' | 'in-progress' }>;

function createRead<Key extends object, Result>(
  key: Accessor<Key | undefined>,
  read: (key: Key, signal: AbortSignal) => Promise<Result>,
  fallback: Result
) {
  const [resolved, setResolved] = createSignal<{ key: Key; result: Result }>();

  createEffect(() => {
    const request = key();
    setResolved(undefined);
    if (!request) return;

    const controller = new AbortController();
    onCleanup(() => controller.abort());

    void (async () => {
      let result: Result;
      try {
        result = await read(request, controller.signal);
      } catch {
        result = fallback;
      }

      if (!controller.signal.aborted) setResolved({ key: request, result });
    })();
  });

  return () => {
    const value = resolved();
    return value && value.key === key() ? value : undefined;
  };
}

export function createBrainEmail(
  scope: Accessor<BrainEmailScope | undefined>,
  reader: BrainEmailReader
): Accessor<BrainEmailMailbox> {
  const currentScope = createMemo(scope, undefined, {
    equals: (left, right) =>
      left === right ||
      (left?.viewer === right?.viewer &&
        left?.team === right?.team &&
        left?.agent === right?.agent),
  });
  const inbox = createRead<BrainEmailScope, BrainEmailMailbox>(
    currentScope,
    async (request, signal) => {
      const result = await reader.readInbox(request, signal);
      if (result.status !== 'provisioned') return result;
      if (!result.address.trim()) return { status: 'unavailable' };

      return {
        ...result,
        readThread: (id, signal) => reader.readThread(request, id, signal),
      };
    },
    { status: 'unavailable' }
  );

  return () => {
    if (!currentScope()) return { status: 'unavailable' };
    return inbox()?.result ?? { status: 'loading' };
  };
}

export function BrainEmailIdentity(props: { mailbox: BrainEmailMailbox }) {
  const provisioned = () =>
    props.mailbox.status === 'provisioned' ? props.mailbox : undefined;

  return (
    <Show when={provisioned()}>
      {(mailbox) => (
        <span class="brain-email-identity">
          <span class="brain-email-address">{mailbox().address}</span>
          <Show when={mailbox().source === 'fixture'}>
            <span class="brain-email-fixture-label">Sample mailbox</span>
          </Show>
        </span>
      )}
    </Show>
  );
}

export function BrainEmail(props: { mailbox: BrainEmailMailbox }) {
  const provisioned = () =>
    props.mailbox.status === 'provisioned' ? props.mailbox : undefined;

  const statusText = () => {
    switch (props.mailbox.status) {
      case 'loading':
        return 'Loading mailbox…';
      case 'in-progress':
        return 'Mailbox setup in progress';
      default:
        return 'Mailbox unavailable';
    }
  };

  return (
    <section class="brain-email" aria-label="Email">
      <Show
        when={provisioned()}
        keyed
        fallback={
          <div class="brain-email-status" role="status">
            {statusText()}
          </div>
        }
      >
        {(mailbox) => <Inbox mailbox={mailbox} />}
      </Show>
    </section>
  );
}

const inboxTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const fullTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function Inbox(props: { mailbox: ProvisionedEmail }) {
  const [query, setQuery] = createSignal('');
  const [selectedId, setSelectedId] = createSignal<string>();
  const [focusedId, setFocusedId] = createSignal<string>();
  const [copied, setCopied] = createSignal('');
  const visible = createMemo(() =>
    filterBrainEmailThreads(props.mailbox.threads, query())
  );
  const selected = createMemo(() =>
    selectBrainEmailThread(visible(), selectedId())
  );
  const thread = createRead<
    BrainEmailThreadSummary,
    BrainEmailThread | undefined
  >(
    selected,
    (summary, signal) => props.mailbox.readThread(summary.id, signal),
    undefined
  );
  const rows = new Map<string, HTMLButtonElement>();
  let list: HTMLDivElement | undefined;
  let heading: HTMLHeadingElement | undefined;
  let viewport: HTMLDivElement | undefined;

  onMount(() => {
    const timers = new Map<Element, number>();
    const scroll = (event: Event) => {
      const target =
        event.target === document ? document.documentElement : event.target;
      if (
        !(target instanceof Element) ||
        (target !== document.documentElement &&
          !(
            viewport?.contains(target) && target.matches('.brain-email-scroll')
          ))
      ) {
        return;
      }

      target.classList.add('brain-email-scrolling');
      window.clearTimeout(timers.get(target));
      const timer = window.setTimeout(() => {
        target.classList.remove('brain-email-scrolling');
        timers.delete(target);
      }, 650);
      timers.set(target, timer);
    };

    document.addEventListener('scroll', scroll, {
      capture: true,
      passive: true,
    });
    onCleanup(() => {
      document.removeEventListener('scroll', scroll, true);
      for (const [target, timer] of timers) {
        window.clearTimeout(timer);
        target.classList.remove('brain-email-scrolling');
      }
    });
  });

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(props.mailbox.address);
      setCopied('Address copied');
    } catch {
      setCopied('Select the address beside the bot name to copy it.');
    }
  }

  function moveFocus(event: KeyboardEvent, index: number) {
    const items = visible();
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (index + items.length - 1) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }

    const item = items[next];
    if (!item) return;
    event.preventDefault();
    rows.get(item.id)?.focus();
  }

  return (
    <div
      class="brain-email-inbox"
      ref={(element) => {
        viewport = element;
      }}
    >
      <div class="brain-email-toolbar">
        <h2>
          Inbox{' '}
          <span class="brain-email-count" role="status">
            {query().trim()
              ? `${visible().length} of ${props.mailbox.threads.length}`
              : props.mailbox.threads.length}
          </span>
        </h2>
        <input
          type="search"
          aria-label="Filter inbox"
          placeholder="Filter inbox"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setFocusedId(undefined);
            if (list) list.scrollTop = 0;
          }}
        />
        <button
          class="brain-email-copy"
          type="button"
          aria-label="Copy mailbox address"
          title="Copy mailbox address"
          onClick={() => void copyAddress()}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <span class="brain-email-copy-status" role="status">
          {copied()}
        </span>
      </div>
      <div class="brain-email-panes">
        <div class="brain-email-list-pane">
          <Show
            when={visible().length > 0}
            fallback={
              <p class="brain-email-status">
                {query().trim() ? 'No matching messages' : 'Inbox is empty'}
              </p>
            }
          >
            <div
              class="brain-email-list brain-email-scroll"
              role="listbox"
              aria-label="Inbox threads"
              ref={(element) => {
                list = element;
              }}
            >
              <For each={visible()}>
                {(summary, index) => (
                  <button
                    ref={(row) => {
                      rows.set(summary.id, row);
                      onCleanup(() => rows.delete(summary.id));
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected()?.id === summary.id}
                    tabIndex={
                      (focusedId() ?? selected()?.id) === summary.id ? 0 : -1
                    }
                    onFocus={() => setFocusedId(summary.id)}
                    onKeyDown={(event) => moveFocus(event, index())}
                    onClick={() => {
                      setSelectedId(summary.id);
                      setFocusedId(summary.id);
                      heading?.focus();
                    }}
                  >
                    <span class="brain-email-sender">{summary.sender}</span>
                    <time dateTime={summary.receivedAt}>
                      {inboxTime.format(new Date(summary.receivedAt))}
                    </time>
                    <span class="brain-email-subject">{summary.subject}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={selected()}>
          {(summary) => (
            <section class="brain-email-detail" aria-label="Selected thread">
              <header class="brain-email-envelope">
                <h3
                  ref={(element) => {
                    heading = element;
                  }}
                  tabIndex={-1}
                >
                  {summary().subject}
                </h3>
                <Show when={thread()?.result} keyed>
                  {(active) => (
                    <details>
                      <summary>
                        {summary().sender} ·{' '}
                        <time dateTime={summary().receivedAt}>
                          {fullTime.format(new Date(summary().receivedAt))}
                        </time>{' '}
                        <span class="brain-email-details-toggle">Details</span>
                      </summary>
                      <dl>
                        <dt>From</dt>
                        <dd>{active.from}</dd>
                        <dt>To</dt>
                        <dd>{active.to}</dd>
                      </dl>
                    </details>
                  )}
                </Show>
              </header>
              <Show
                when={thread()?.result}
                keyed
                fallback={
                  <p class="brain-email-status" role="status">
                    {thread() ? 'Thread unavailable' : 'Loading thread…'}
                  </p>
                }
              >
                {(active) => <MessageReader thread={active} />}
              </Show>
            </section>
          )}
        </Show>
      </div>
    </div>
  );
}

function MessageReader(props: { thread: BrainEmailThread }) {
  const [scrollable, setScrollable] = createSignal(false);

  function observeReader(reader: HTMLDivElement) {
    onMount(() => {
      const size = new ResizeObserver(() => {
        setScrollable(
          getComputedStyle(reader).overflowY === 'auto' &&
            reader.scrollHeight > reader.clientHeight
        );
      });

      size.observe(reader);
      for (const message of reader.children) size.observe(message);
      onCleanup(() => size.disconnect());
    });
  }

  return (
    <div
      class="brain-email-reader brain-email-scroll"
      role="region"
      aria-label="Message reader"
      tabIndex={scrollable() ? 0 : undefined}
      ref={observeReader}
    >
      <For each={props.thread.messages}>
        {(message) => (
          <article>
            <header>
              <strong>{message.author}</strong>
              <span>{message.address}</span>
              <time dateTime={message.sentAt}>
                {fullTime.format(new Date(message.sentAt))}
              </time>
            </header>
            <p>{message.text}</p>
          </article>
        )}
      </For>
    </div>
  );
}
