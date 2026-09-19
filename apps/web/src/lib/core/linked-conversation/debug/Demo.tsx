/**
 * Demo for `LinkedConversation`: point it at any channel thread by entering a
 * channel id + message id (or pasting a copied message link). Mounted at
 * `/component/linked-conversation`.
 */

import { URL_PARAMS } from '@channel/Channel/link';
import { useDrawerControl } from '@components/app/split-layout/components/SplitDrawerContext';
import { createSignal, Show, Suspense } from 'solid-js';
import { createChannelThreadSource } from '../channel-thread-source';
import { LinkedConversation } from '../LinkedConversation';
import { LinkedConversationDrawer } from '../LinkedConversationDrawer';

const DEMO_DRAWER_ID = 'linked-conversation-demo';

const STORAGE_KEY = 'linked-conversation-demo-target';

type Target = { channelId: string; messageId: string };

function loadSavedTarget(): Target {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Target;
  } catch {
    // fall through to the empty target
  }
  return { channelId: '', messageId: '' };
}

/**
 * Parses a copied channel message link
 * (`/app/channel/{channelId}?channel_message_id=…&channel_thread_id=…`).
 * The thread id wins as the root when present, so links copied from replies
 * load the whole conversation.
 */
function parseMessageLink(link: string): Target | undefined {
  try {
    const url = new URL(link);
    const channelId = /\/app\/channel\/([^/?#]+)/.exec(url.pathname)?.[1];
    const messageId =
      url.searchParams.get(URL_PARAMS.thread) ??
      url.searchParams.get(URL_PARAMS.message);
    if (channelId && messageId) return { channelId, messageId };
  } catch {
    // not a URL
  }
  return undefined;
}

export default function LinkedConversationDemo() {
  const saved = loadSavedTarget();
  const [channelIdInput, setChannelIdInput] = createSignal(saved.channelId);
  const [messageIdInput, setMessageIdInput] = createSignal(saved.messageId);
  const [target, setTarget] = createSignal<Target>();

  const load = (event: Event) => {
    event.preventDefault();
    const next = {
      channelId: channelIdInput().trim(),
      messageId: messageIdInput().trim(),
    };
    if (!next.channelId || !next.messageId) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setTarget(next);
  };

  const handleLinkPaste = (value: string) => {
    const parsed = parseMessageLink(value);
    if (!parsed) return;
    setChannelIdInput(parsed.channelId);
    setMessageIdInput(parsed.messageId);
  };

  const inputClass =
    'w-80 rounded border border-edge-muted bg-surface px-2 py-1 text-sm text-ink font-mono';

  return (
    <div class="p-8 space-y-6 bg-surface min-h-full overflow-auto">
      <div>
        <h1 class="text-xl font-bold text-ink mb-2">LinkedConversation</h1>
        <p class="text-sm text-ink-muted">
          Read-only rendering of a conversation (root message + reply chain)
          from a <code>LinkedConversationSource</code>, here backed by a channel
          thread via <code>createChannelThreadSource</code>.
        </p>
      </div>

      <form onSubmit={load} class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-xs text-ink-muted">
          Paste a message link (fills the ids below)
          <input
            class={inputClass}
            placeholder="https://macro.com/app/channel/…?channel_message_id=…"
            onInput={(e) => handleLinkPaste(e.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink-muted">
          Channel id
          <input
            class={inputClass}
            value={channelIdInput()}
            onInput={(e) => setChannelIdInput(e.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink-muted">
          Message id (thread root)
          <input
            class={inputClass}
            value={messageIdInput()}
            onInput={(e) => setMessageIdInput(e.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          class="w-fit rounded border border-edge-muted bg-surface px-3 py-1 text-sm text-ink hover:bg-hover"
          disabled={!channelIdInput().trim() || !messageIdInput().trim()}
        >
          Load conversation
        </button>
      </form>

      <Show when={target()} keyed>
        {(t) => (
          <>
            <DrawerToggle />
            <div class="max-w-2xl rounded-md border border-edge-muted p-3">
              <Suspense
                fallback={<p class="text-sm text-ink-muted">Loading…</p>}
              >
                <ConversationViewer target={t} />
              </Suspense>
            </div>
            <LinkedConversationDrawer
              id={DEMO_DRAWER_ID}
              channelId={t.channelId}
              messageId={t.messageId}
            />
          </>
        )}
      </Show>
    </div>
  );
}

function DrawerToggle() {
  const drawer = useDrawerControl(DEMO_DRAWER_ID);
  return (
    <button
      type="button"
      class="w-fit rounded border border-edge-muted bg-surface px-3 py-1 text-sm text-ink hover:bg-hover"
      onClick={drawer.toggle}
    >
      Open in drawer
    </button>
  );
}

function ConversationViewer(props: { target: Target }) {
  const source = createChannelThreadSource({
    channelId: () => props.target.channelId,
    messageId: () => props.target.messageId,
  });

  return (
    <Show
      when={source.root()}
      fallback={
        <p class="text-sm text-ink-muted">
          No message found — check the channel id and message id.
        </p>
      }
    >
      <LinkedConversation source={source} />
    </Show>
  );
}
