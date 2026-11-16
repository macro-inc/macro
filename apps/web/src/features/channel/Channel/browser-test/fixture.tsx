import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  ThreadList,
  type ThreadListInitialPosition,
  type ThreadListScrollSnapshot,
} from '../ThreadList';

const WORDS =
  'the agent read the channel history and opened a pull request with the fix while the team kept talking about the release'.split(
    ' '
  );

// Messages of varied length, so rows rewrap when the pane narrows.
const messages = Array.from({ length: 200 }, (_, index) => ({
  id: `message-${index}`,
  text: Array.from(
    { length: 6 + ((index * 37) % 90) },
    (_, word) => WORDS[(index + word) % WORDS.length]
  ).join(' '),
}));
const text = new Map(messages.map((message) => [message.id, message.text]));
const keys = messages.map((message) => message.id);

declare global {
  interface Window {
    setPaneWidth: (width: string) => void;
    /** Reopens the channel from its last scroll snapshot, at the pane's width. */
    reopenChannel: () => void;
  }
}

/** The production channel list in a pane whose width the test controls. */
function Fixture() {
  const [width, setWidth] = createSignal('100%');
  window.setPaneWidth = setWidth;
  const [open, setOpen] = createSignal(true);
  let snapshot: ThreadListScrollSnapshot | undefined;
  let initialPosition: ThreadListInitialPosition = { type: 'latest' };
  window.reopenChannel = () => {
    setOpen(false);
    if (snapshot) initialPosition = { type: 'restore', snapshot };
    setOpen(true);
  };

  return (
    <main style={{ height: '100vh', margin: 0, font: '16px/24px sans-serif' }}>
      <div
        data-pane
        style={{ position: 'relative', height: '100%', width: width() }}
      >
        <Show when={open()}>
          <ThreadList
            keys={() => keys}
            initialPosition={initialPosition}
            onScroll={(_state, next) => {
              snapshot = next ?? snapshot;
            }}
          >
            {(item) => (
              <div data-message={item.id} style={{ padding: '8px 0' }}>
                <strong>{item.id}</strong> {text.get(item.id)}
              </div>
            )}
          </ThreadList>
        </Show>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
