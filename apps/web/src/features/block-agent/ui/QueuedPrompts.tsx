/**
 * The list of actions waiting in the session's server-side queue, rendered
 * between the transcript and the input.
 *
 * Rendered newest-at-top: the next prompt to dispatch (the oldest) sits at
 * the bottom, immediately above the composer, so Up from the input lands on
 * "the one about to be sent" and further Up presses walk toward the newest.
 *
 * Each prompt row is a live Lexical surface, always editable in place —
 * edits debounce and autosave through `onEdit`, with a flush on blur; there
 * are no save/cancel affordances. Non-prompt entries (compact) are
 * read-only text but keep their remove affordance, which is always visible.
 */

import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, Surface } from '@ui';
import {
  createEffect,
  createMemo,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

export type QueuedPromptItem = {
  /** The id the action was accepted under — the row's identity. */
  actionId: string;
  /** `prompt` or `compact`; only prompts carry text and can be edited. */
  kind: string;
  /** The prompt's raw text, absent for a compact. */
  prompt?: string;
  /** Who queued it, when it was somebody other than the current user. */
  queuedBy?: string;
};

export interface QueuedPromptsProps {
  /** In dispatch order — oldest (next to send) first, as the server reports. */
  items: QueuedPromptItem[];
  /** Autosave a queued prompt's replacement text. The rows debounce. */
  onEdit: (actionId: string, prompt: string) => void;
  /** Remove a queued action before it dispatches. */
  onRemove: (actionId: string) => void;
  /** Down past the bottom (next-to-send) row — focus returns to the composer. */
  onNavigateBelow?: () => void;
  /**
   * Ref-style: receives a function that focuses the bottom row (the next
   * prompt to dispatch) — the composer's Up-at-start target — and
   * `undefined` again on unmount.
   */
  registerFocusFromBelow?: (focus: (() => void) | undefined) => void;
}

/** How long typing pauses before the row autosaves. */
const AUTOSAVE_DEBOUNCE_MS = 400;

export function QueuedPrompts(props: QueuedPromptsProps) {
  // Reversed for render: newest at the top, next-to-dispatch at the bottom.
  // `For` keys on the id strings, so a snapshot that only re-orders or edits
  // never remounts a row (and never drops an editor mid-keystroke).
  const orderedIds = createMemo(() =>
    props.items.map((item) => item.actionId).reverse()
  );
  const itemById = (id: string) =>
    props.items.find((item) => item.actionId === id);

  const focusFns = new Map<string, () => void>();
  const focusAt = (index: number) => {
    const id = orderedIds()[index];
    if (id) focusFns.get(id)?.();
  };
  /** Walk focus up (-1, toward newest) or down (+1, toward the composer). */
  const moveFocus = (id: string, delta: 1 | -1) => {
    const ids = orderedIds();
    const index = ids.indexOf(id);
    if (index < 0) return;
    const next = index + delta;
    if (next >= ids.length) {
      props.onNavigateBelow?.();
      return;
    }
    if (next >= 0) focusAt(next);
  };

  onMount(() => {
    props.registerFocusFromBelow?.(() => focusAt(orderedIds().length - 1));
    onCleanup(() => props.registerFocusFromBelow?.(undefined));
  });

  return (
    <div class="flex flex-col gap-1" data-testid="agent-queued-prompts">
      <For each={orderedIds()}>
        {(id) => (
          <Show when={itemById(id)}>
            {(item) => (
              <QueuedRow
                item={item()}
                registerFocus={(focus) => {
                  if (focus) focusFns.set(id, focus);
                  else focusFns.delete(id);
                }}
                onMoveUp={() => moveFocus(id, -1)}
                onMoveDown={() => moveFocus(id, 1)}
                onEdit={(prompt) => props.onEdit(id, prompt)}
                onRemove={() => props.onRemove(id)}
              />
            )}
          </Show>
        )}
      </For>
    </div>
  );
}

type QueuedRowProps = {
  item: QueuedPromptItem;
  /** Ref-style: how navigation focuses this row; `undefined` on unmount. */
  registerFocus: (focus: (() => void) | undefined) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: (prompt: string) => void;
  onRemove: () => void;
};

function QueuedRow(props: QueuedRowProps) {
  onMount(() => {
    onCleanup(() => props.registerFocus(undefined));
  });

  return (
    <Surface class="rounded-lg" depth={1} solid>
      <div class="flex items-start gap-2 px-3 py-1.5">
        <div class="min-w-0 flex-1">
          <Show
            when={props.item.kind === 'prompt'}
            fallback={<CompactBody {...props} />}
          >
            <PromptBody {...props} />
          </Show>
          <div class="text-xs text-ink-extra-muted">
            Queued
            <Show when={props.item.queuedBy}>
              {(name) => <> by {name()}</>}
            </Show>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Remove queued message"
          onClick={() => props.onRemove()}
          class="shrink-0"
        >
          <XIcon class="size-3.5" />
        </Button>
      </div>
    </Surface>
  );
}

/**
 * The always-editable body of a prompt row: the same Lexical markdown
 * surface as the composer's input, minus its send machinery. Edits debounce
 * into `onEdit` and flush when focus leaves the row.
 */
function PromptBody(props: QueuedRowProps) {
  // The last text this row and the server agree on: what was mounted,
  // applied from a server snapshot, or handed to `onEdit`. Both the autosave
  // and the anti-clobber check compare against it.
  let synced = props.item.prompt ?? '';
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    const text = editor.controls.getMarkdown();
    // An emptied row is not an edit to send — the server refuses empty
    // prompts and "delete the text" has the remove affordance for it.
    if (text === synced || text.trim().length === 0) return;
    synced = text;
    props.onEdit(text);
  };

  const scheduleSave = (markdown: string) => {
    if (markdown === synced) return;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  const editor = buildConfig('chat')
    .namespace('agent-queued-prompt')
    .withHistory({ timeGap: 400 })
    .onChange(scheduleSave)
    .onFocusLeave({
      onStart: (event) => {
        event.preventDefault();
        flush();
        props.onMoveUp();
      },
      onEnd: (event) => {
        event.preventDefault();
        flush();
        props.onMoveDown();
      },
    });

  onMount(() => {
    props.registerFocus(() => editor.controls.focus());
    onCleanup(() => {
      if (saveTimer !== undefined) clearTimeout(saveTimer);
    });
  });

  // A server snapshot may carry someone else's edit. Apply it only while
  // this row is
  // untouched — never over a focused editor or unsaved local changes, which
  // are about to become the server's text anyway.
  createEffect(() => {
    const server = props.item.prompt ?? '';
    if (server === synced) return;
    const root = editor.lexical.getRootElement();
    const focused = root?.contains(document.activeElement) ?? false;
    const dirty =
      saveTimer !== undefined || editor.controls.getMarkdown() !== synced;
    if (focused || dirty) return;
    editor.controls.setMarkdown(server);
    synced = server;
  });

  return (
    <div class="text-sm text-ink" onFocusOut={flush}>
      <MarkdownShell config={editor} initialValue={props.item.prompt} />
    </div>
  );
}

/** A compact stays read-only: there is no text of the user's to rewrite. */
function CompactBody(props: QueuedRowProps) {
  let element: HTMLDivElement | undefined;
  onMount(() => {
    props.registerFocus(() => element?.focus());
  });
  return (
    <div
      ref={element}
      tabindex="-1"
      class="text-sm text-ink outline-none"
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          props.onMoveUp();
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          props.onMoveDown();
        }
      }}
    >
      Compact the conversation
    </div>
  );
}
