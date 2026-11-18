import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { type Accessor, createSignal } from 'solid-js';
import { match, P } from 'ts-pattern';

type ReaderMessage =
  | { kind: 'readers'; tab: string; seq: number; open: boolean }
  | { kind: 'roll-call'; tab: string; seq: number };

// Every tab ranks people from the context the leader tab publishes, so the
// leader may leave that context's inputs stale only while no tab has a contact
// window open. A tab announces when its first window opens and its last one
// closes, and asks the others when it starts listening. A tab that vanishes
// without saying so stays counted as open, which only keeps the publisher as
// eager as it was before.
const TAB = crypto.randomUUID();
const bus = createCrossTabBus<ReaderMessage>({
  channelName: 'contact-readers',
  storageKey: 'macro.contact-readers',
  parse: (value) =>
    match(value)
      .with(
        { kind: 'readers', tab: P.string, seq: P.number, open: P.boolean },
        ({ kind, tab, seq, open }) => ({ kind, tab, seq, open })
      )
      .with(
        { kind: 'roll-call', tab: P.string, seq: P.number },
        ({ kind, tab, seq }) => ({ kind, tab, seq })
      )
      .otherwise(() => null),
  getMessageKey: (message) => `${message.tab}:${message.seq}`,
});

const [localReaders, setLocalReaders] = createSignal(0);
const [remoteTabs, setRemoteTabs] = createSignal<readonly string[]>([]);
const lastSeq = new Map<string, number>();
let seq = 0;
let listening = false;

function send(
  message: { kind: 'readers'; open: boolean } | { kind: 'roll-call' }
) {
  bus.publish({ ...message, tab: TAB, seq: ++seq });
}

function receive(message: ReaderMessage) {
  // The two transports can deliver one tab's messages out of order.
  if (message.tab === TAB || (lastSeq.get(message.tab) ?? 0) >= message.seq)
    return;
  lastSeq.set(message.tab, message.seq);
  match(message)
    .with({ kind: 'roll-call' }, () => {
      if (localReaders() > 0) send({ kind: 'readers', open: true });
    })
    .with({ kind: 'readers' }, ({ tab, open }) =>
      setRemoteTabs((tabs) => {
        const others = tabs.filter((other) => other !== tab);
        return open ? [...others, tab] : others;
      })
    )
    .exhaustive(() => undefined);
}

function listen() {
  if (listening) return;
  listening = true;
  bus.subscribe(receive);
  window.addEventListener('pagehide', () => {
    if (localReaders() > 0) send({ kind: 'readers', open: false });
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    if (localReaders() > 0) send({ kind: 'readers', open: true });
    send({ kind: 'roll-call' });
  });
  send({ kind: 'roll-call' });
}

/** Holds a contact window open until the returned release is called. */
export function openContactReader(): () => void {
  listen();
  if (setLocalReaders((count) => count + 1) === 1)
    send({ kind: 'readers', open: true });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (setLocalReaders((count) => count - 1) === 0)
      send({ kind: 'readers', open: false });
  };
}

/** Starts following other tabs' windows; true while any tab has one open. */
export function watchContactReaders(): Accessor<boolean> {
  listen();
  return () => localReaders() > 0 || remoteTabs().length > 0;
}
