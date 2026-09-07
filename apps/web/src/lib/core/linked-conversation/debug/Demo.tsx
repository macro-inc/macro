/**
 * Demo for `LinkedConversation`: point it at a channel or document thread by
 * entering its parent + root message id (or pasting a channel link). Mounted at
 * `/component/linked-conversation`.
 */

import { URL_PARAMS } from '@channel/Channel/link';
import { useDrawerControl } from '@components/app/split-layout/components/SplitDrawerContext';
import type { MessageParent } from '@service-storage/messages';
import { createSignal, Show, Suspense } from 'solid-js';
import { LinkedConversation } from '../LinkedConversation';
import { LinkedConversationDrawer } from '../LinkedConversationDrawer';
import { createMessageThreadSource } from '../message-thread-source';

const DEMO_DRAWER_ID = 'linked-conversation-demo';

const STORAGE_KEY = 'linked-conversation-demo-parent-target';

type Target = { parent: MessageParent; messageId: string };

function loadSavedTarget(): Target {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Target;
  } catch {
    // fall through to the empty target
  }
  return { parent: { type: 'channel', id: '' }, messageId: '' };
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
    if (channelId && messageId)
      return { parent: { type: 'channel', id: channelId }, messageId };
  } catch {
    // not a URL
  }
  return undefined;
}

export default function LinkedConversationDemo() {
  const saved = loadSavedTarget();
  const [parentType, setParentType] = createSignal(saved.parent.type);
  const [parentIdInput, setParentIdInput] = createSignal(saved.parent.id);
  const [messageIdInput, setMessageIdInput] = createSignal(saved.messageId);
  const [target, setTarget] = createSignal<Target>();
  const [showPreview, setShowPreview] = createSignal(false);

  const load = (event: Event) => {
    event.preventDefault();
    const next = {
      parent: { type: parentType(), id: parentIdInput().trim() },
      messageId: messageIdInput().trim(),
    };
    if (!next.parent.id || !next.messageId) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setTarget(next);
  };

  const handleLinkPaste = (value: string) => {
    const parsed = parseMessageLink(value);
    if (!parsed) return;
    setParentType(parsed.parent.type);
    setParentIdInput(parsed.parent.id);
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
          from a channel or document using{' '}
          <code>createMessageThreadSource</code>.
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
          Parent type
          <select
            class={inputClass}
            value={parentType()}
            onChange={(e) =>
              setParentType(e.currentTarget.value as MessageParent['type'])
            }
          >
            <option value="channel">Channel</option>
            <option value="document">Document</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink-muted">
          Parent id
          <input
            class={inputClass}
            value={parentIdInput()}
            onInput={(e) => setParentIdInput(e.currentTarget.value)}
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
          disabled={!parentIdInput().trim() || !messageIdInput().trim()}
        >
          Load conversation
        </button>
      </form>

      <Show when={target()} keyed>
        {(t) => (
          <>
            <DrawerToggle />
            <label class="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={showPreview()}
                onChange={(e) => setShowPreview(e.currentTarget.checked)}
              />
              Show inline preview
            </label>
            <Show when={showPreview()}>
              <div class="max-w-2xl rounded-md border border-edge-muted p-3">
                <Suspense
                  fallback={<p class="text-sm text-ink-muted">Loading…</p>}
                >
                  <ConversationViewer target={t} />
                </Suspense>
              </div>
            </Show>
            <LinkedConversationDrawer
              id={DEMO_DRAWER_ID}
              parent={t.parent}
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
  const source = createMessageThreadSource(
    () => props.target.parent,
    () => props.target.messageId
  );

  return (
    <Show
      when={source.root()}
      fallback={
        <p class="text-sm text-ink-muted">
          No message found — check the parent and message ids.
        </p>
      }
    >
      <LinkedConversation source={source} />
    </Show>
  );
}
