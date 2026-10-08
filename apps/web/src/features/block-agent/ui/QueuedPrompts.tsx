/**
 * The list of actions waiting in the session's server-side queue, rendered
 * between the transcript and the input.
 *
 * Rendered newest-at-top: the next prompt to dispatch (the oldest) sits at
 * the bottom, immediately above the composer, so Up from the input lands on
 * "the one about to be sent" and further Up presses walk toward the newest.
 *
 * Rows start as one-line previews rendered through the static Lexical
 * surface, so mentions and links read as they do in the transcript rather
 * than as their serialized markup. Opening a prompt reveals its scrollable
 * Lexical editor; only one row is expanded at a time.
 * Edits debounce and autosave through `onEdit`, with a flush on blur; there
 * are no save/cancel affordances. Non-prompt entries (compact) are
 * read-only text but keep their remove affordance, which is always visible.
 * While a turn is in flight, each row offers Steer: that message jumps the
 * queue and the current turn is cancelled so it runs next.
 */

import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import CaretUpIcon from '@phosphor-icons/core/regular/caret-up.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, Surface } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
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
  /** Files the prompt refers to; an edit keeps them, only the text changes. */
  attachments?: { name: string; mimeType?: string | null }[];
  /** Who queued it, when it was somebody other than the current user. */
  queuedBy?: string;
};

export interface QueuedPromptsProps {
  /** In dispatch order — oldest (next to send) first, as the server reports. */
  items: QueuedPromptItem[];
  /** Keep queued text visible without allowing changes. */
  disabled?: boolean;
  /** Autosave a queued prompt's replacement text. The rows debounce. */
  onEdit: (actionId: string, prompt: string) => void;
  /** Remove a queued action before it dispatches. */
  onRemove: (actionId: string) => void;
  /**
   * Interrupt the turn in flight and run this queued action next. Absent
   * when nothing is in flight: the queue drains on its own once the turn
   * ends, and the composer's flush control sends the oldest entry.
   */
  onSteer?: (actionId: string) => void;
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
  const [expandedId, setExpandedId] = createSignal<string>();
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

  // A long queue scrolls within a capped height rather than pushing the
  // transcript away. `flex-col-reverse` around the single list anchors the
  // scroll at the bottom, so the next-to-dispatch row stays in view, without
  // reordering the DOM (focus order still runs newest to next).
  return (
    <div class="flex max-h-[min(40vh,24rem)] flex-col-reverse overflow-y-auto overscroll-contain">
      <div
        class="flex shrink-0 flex-col gap-1"
        data-testid="agent-queued-prompts"
      >
        <For each={orderedIds()}>
          {(id) => (
            <Show when={itemById(id)}>
              {(item) => (
                <QueuedRow
                  item={item()}
                  disabled={props.disabled}
                  expanded={expandedId() === id}
                  onExpandedChange={(expanded) =>
                    setExpandedId(expanded ? id : undefined)
                  }
                  registerFocus={(focus) => {
                    if (focus) focusFns.set(id, focus);
                    else focusFns.delete(id);
                  }}
                  onMoveUp={() => moveFocus(id, -1)}
                  onMoveDown={() => moveFocus(id, 1)}
                  onEdit={(prompt) => props.onEdit(id, prompt)}
                  onRemove={() => props.onRemove(id)}
                  onSteer={
                    props.onSteer ? () => props.onSteer?.(id) : undefined
                  }
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}

type QueuedRowProps = {
  item: QueuedPromptItem;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  disabled?: boolean;
  /** Ref-style: how navigation focuses this row; `undefined` on unmount. */
  registerFocus: (focus: (() => void) | undefined) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: (prompt: string) => void;
  onRemove: () => void;
  /** Interrupt the current turn and send this row next. */
  onSteer?: () => void;
};

function QueuedRow(props: QueuedRowProps) {
  const editorId = createUniqueId();
  const [draft, setDraft] = createSignal<string>();
  let toggle: HTMLButtonElement | undefined;
  let focusBody: (() => void) | undefined;
  // The collapsed line shows the prompt's markdown; an empty prompt (files
  // only) and a compact fall back to a plain label.
  const previewMarkdown = () =>
    props.item.kind === 'prompt'
      ? (draft() ?? props.item.prompt ?? '').trim()
      : '';
  const previewLabel = () =>
    props.item.kind === 'prompt'
      ? 'Attached files'
      : 'Compact the conversation';
  const open = () => {
    props.onExpandedChange(true);
    focusBody?.();
  };
  const close = () => {
    // Moving focus flushes the editor's pending autosave before hiding it.
    toggle?.focus();
    props.onExpandedChange(false);
  };

  onMount(() => {
    props.registerFocus(open);
    onCleanup(() => props.registerFocus(undefined));
  });

  return (
    <Surface class="h-auto shrink-0 rounded-lg" depth={1} solid>
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <div class="flex items-center gap-2 px-3 py-1">
          <button
            ref={toggle}
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-xs py-1 text-left text-sm text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-expanded={props.expanded}
            aria-controls={editorId}
            title={
              props.expanded
                ? 'Collapse queued message'
                : 'Expand queued message'
            }
            onClick={() => (props.expanded ? close() : open())}
          >
            <CaretUpIcon
              class="size-3 shrink-0 text-ink-muted transition-transform"
              classList={{ 'rotate-180': props.expanded }}
            />
            <Show
              when={previewMarkdown()}
              fallback={<span class="truncate">{previewLabel()}</span>}
            >
              {(markdown) => (
                // Interactive content in the rendered preview (mentions,
                // links) must not swallow the click that opens the row.
                <div class="pointer-events-none min-w-0 flex-1 truncate">
                  <StaticMarkdown
                    markdown={markdown()}
                    theme={singleLineMarkdownTheme}
                    singleLine
                  />
                </div>
              )}
            </Show>
          </button>
          <span class="shrink-0 text-xs text-ink-extra-muted">
            Queued
            <Show when={props.item.queuedBy}>
              {(name) => <> by {name()}</>}
            </Show>
          </span>
          <Show when={props.onSteer}>
            <Button
              variant="ghost"
              size="xs"
              label="Steer"
              tooltip="Interrupt the current turn and send this message next"
              disabled={props.disabled}
              onClick={() => props.onSteer?.()}
              class="shrink-0"
            >
              Steer
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Remove queued message"
            disabled={props.disabled}
            onClick={() => props.onRemove()}
            class="shrink-0"
          >
            <XIcon class="size-3.5" />
          </Button>
        </div>
        <div
          id={editorId}
          class="max-h-[min(32vh,16rem)] overflow-y-auto overscroll-contain border-t border-edge-muted px-3 py-2"
          hidden={!props.expanded}
        >
          <Show
            when={props.item.kind === 'prompt'}
            fallback={
              <CompactBody
                {...props}
                registerFocus={(focus) => (focusBody = focus)}
              />
            }
          >
            <PromptBody
              {...props}
              registerFocus={(focus) => (focusBody = focus)}
              onDraftChange={setDraft}
              onCollapse={close}
            />
          </Show>
        </div>
      </div>
    </Surface>
  );
}

/**
 * The editable body of an expanded prompt row: the same Lexical markdown
 * surface as the composer's input, minus its send machinery. Edits debounce
 * into `onEdit` and flush when focus leaves the row.
 */
function PromptBody(
  props: QueuedRowProps & {
    onDraftChange: (text: string) => void;
    onCollapse: () => void;
  }
) {
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
    if (props.disabled) return;
    const text = editor.controls.getMarkdown();
    // An emptied row is not an edit to send — the server refuses empty
    // prompts and "delete the text" has the remove affordance for it.
    if (text === synced || text.trim().length === 0) return;
    synced = text;
    props.onEdit(text);
  };

  const scheduleSave = (markdown: string) => {
    if (props.disabled) return;
    props.onDraftChange(markdown);
    if (markdown === synced) return;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  // Mirrors `AgentInput`'s editor features so a queued prompt edits the way
  // it was written: `@` mentions, links, emojis, and code blocks.
  const editor = buildConfig('chat')
    .withAppLinkResolver(useMacroMentionLinkResolver())
    .namespace('agent-queued-prompt')
    .withMentions({ showOpenTabs: true, block: 'agent' })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .onChange(scheduleSave)
    .onEscape(() => {
      flush();
      props.onCollapse();
      return true;
    })
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
    props.onDraftChange(server);
    synced = server;
  });

  return (
    <div class="text-sm text-ink" onFocusOut={flush}>
      <MarkdownShell
        config={editor}
        initialValue={props.item.prompt}
        disabled={props.disabled}
      />
      {/* Attached files ride the prompt as-is: an edit rewrites the text and
          keeps them, so they are shown but not editable here. */}
      <Show when={props.item.attachments?.length}>
        <div
          class="flex flex-wrap gap-1 pt-1 text-xs text-ink-muted"
          data-testid="agent-queued-attachments"
        >
          <For each={props.item.attachments}>
            {(attachment) => (
              <span class="rounded-xs border border-edge-muted px-1.5 py-0.5">
                {attachment.name}
              </span>
            )}
          </For>
        </div>
      </Show>
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
