/**
 * The list of actions waiting in the session's server-side queue, rendered
 * between the transcript and the input.
 *
 * Rendered newest-at-top: the next prompt to dispatch (the oldest) sits at
 * the bottom, immediately above the composer, so Up from the input lands on
 * "the one about to be sent" and further Up presses walk toward the newest.
 *
 * Each row shows its prompt exactly once. Closed, that is a one-line preview
 * rendered through the static Lexical surface, so mentions and links read as
 * they do in the transcript rather than as serialized markup. Opening a row
 * swaps the preview for the editor in the same place; only one row is open
 * at a time. Enter saves the edit through `onEdit`, Escape restores the last
 * saved text, and both close the row and hand focus back to the composer
 * (`onNavigateBelow`). Focus moving to another control outside the row saves
 * and closes it too.
 * Non-prompt entries (compact) are read-only text but keep their remove
 * affordance, which is always visible.
 * While a turn is in flight, each row offers Steer: that message jumps the
 * queue and the current turn is cancelled so it runs next. A row whose
 * steer the server refused stays queued and says it was not sent.
 */

import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import XIcon from '@icon/system/regular/x.svg?component-solid';
import { stripAgentContext } from '@macro-inc/lexical-core/utils/parsers';
import { Button, Surface, Tooltip } from '@ui';
import { COMMAND_PRIORITY_NORMAL, KEY_ESCAPE_COMMAND } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
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
  /** A force-send of it was refused; it is still queued and can be retried. */
  sendFailed?: boolean;
};

export interface QueuedPromptsProps {
  /** In dispatch order — oldest (next to send) first, as the server reports. */
  items: QueuedPromptItem[];
  /** Keep queued text visible without allowing changes. */
  disabled?: boolean;
  /** Save a queued prompt's replacement text (Enter, or focus leaving it). */
  onEdit: (actionId: string, prompt: string) => void;
  /** Remove a queued action before it dispatches. */
  onRemove: (actionId: string) => void;
  /**
   * Interrupt the turn in flight and run this queued action next. Absent
   * when nothing is in flight: the queue drains on its own once the turn
   * ends, and the composer's flush control sends the oldest entry.
   */
  onSteer?: (actionId: string) => void;
  /**
   * Focus returns to the composer: after Enter or Escape in a row, and on
   * Down past the bottom (next-to-send) row.
   */
  onNavigateBelow?: () => void;
  /**
   * Ref-style: receives a function that opens the bottom row (the next
   * prompt to dispatch) for editing — the composer's Up-at-start target —
   * and `undefined` again on unmount.
   */
  registerFocusFromBelow?: (focus: (() => void) | undefined) => void;
}

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
                  onLeave={props.onNavigateBelow}
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
  /** Where focus goes when the row closes (the composer). */
  onLeave?: () => void;
  onEdit: (prompt: string) => void;
  onRemove: () => void;
  /** Interrupt the current turn and send this row next. */
  onSteer?: () => void;
};

function QueuedRow(props: QueuedRowProps) {
  const editorId = createUniqueId();
  const [draft, setDraft] = createSignal<string>();
  let row: HTMLDivElement | undefined;
  let preview: HTMLButtonElement | undefined;
  let focusBody: (() => void) | undefined;
  const isPrompt = () => props.item.kind === 'prompt';
  const previewMarkdown = () =>
    isPrompt()
      ? (draft() ?? stripAgentContext(props.item.prompt ?? '')).trim()
      : '';
  const previewLabel = () =>
    isPrompt() ? 'Attached files' : 'Compact the conversation';
  const open = () => {
    props.onExpandedChange(true);
    focusBody?.();
  };
  // Focus moves first, so the editor's focus-out save runs while it is
  // still shown, and the row's focus-out closes it; the explicit close
  // covers focus that did not move. Without a composer to land on, the
  // closed preview takes focus so the keyboard never loses its place.
  const close = () => {
    if (props.onLeave) {
      props.onLeave();
      props.onExpandedChange(false);
    } else {
      props.onExpandedChange(false);
      preview?.focus();
    }
  };

  onMount(() => {
    props.registerFocus(open);
    onCleanup(() => props.registerFocus(undefined));
  });

  return (
    <Surface class="h-auto shrink-0 rounded-lg" depth={1} solid>
      <div
        ref={row}
        class="flex gap-2 px-3 py-1"
        classList={{
          'items-center': !props.expanded,
          'items-start': props.expanded,
        }}
        // Focus moving to another control (the composer, another row)
        // closes the row; the editor's own focus-out has saved by then. A
        // touch keyboard has no Escape, so this is how a tapped row closes.
        // The editor's own floating menus (links) are portaled outside the
        // row and keep it open.
        onFocusOut={(event) => {
          const next = event.relatedTarget;
          if (
            props.expanded &&
            next instanceof Element &&
            !row?.contains(next) &&
            !next.closest('.menu-surface')
          )
            props.onExpandedChange(false);
        }}
        // Escape inside the editor or one of its menus is theirs (the
        // editor's own Escape command decides); this only serves focus the
        // row holds elsewhere: a compact row, a viewer's body, the buttons.
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest('[data-lexical-editor], .menu-surface')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        {/* One slot, one text: the preview and the editor take turns in it. */}
        <div class="min-w-0 flex-1">
          <Tooltip
            label={isPrompt() ? 'Edit queued message' : 'Open queued action'}
            as="div"
            class="min-w-0"
            disabled={props.expanded}
          >
            <button
              ref={preview}
              type="button"
              class="flex w-full min-w-0 items-center rounded-xs py-1 text-left text-sm text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-expanded={props.expanded}
              aria-controls={editorId}
              hidden={props.expanded}
              onClick={open}
            >
              <Show
                when={previewMarkdown()}
                fallback={<span class="truncate">{previewLabel()}</span>}
              >
                {(markdown) => (
                  // Inert so chips and links never take the click that opens
                  // the row.
                  <div class="min-w-0 flex-1 truncate">
                    <StaticMarkdown
                      markdown={markdown()}
                      theme={singleLineMarkdownTheme}
                      singleLine
                      inert
                    />
                  </div>
                )}
              </Show>
            </button>
          </Tooltip>
          <div
            id={editorId}
            class="max-h-[min(32vh,16rem)] overflow-y-auto overscroll-contain py-1"
            hidden={!props.expanded}
          >
            <Show
              when={isPrompt()}
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
                onClose={close}
              />
            </Show>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2 py-1">
          <Show
            when={props.item.sendFailed}
            fallback={
              <span class="shrink-0 text-xs text-ink-extra-muted">
                Queued
                <Show when={props.item.queuedBy}>
                  {(name) => <> by {name()}</>}
                </Show>
              </span>
            }
          >
            <span
              class="shrink-0 text-xs text-failure-ink"
              role="status"
              title="This message could not be sent. It is still queued."
            >
              Not sent
            </span>
          </Show>
          <Show when={props.onSteer}>
            <Button
              aria-label="Steer"
              variant="ghost"
              size="xs"
              tooltip="Interrupt the current turn and send this message next"
              disabled={props.disabled}
              onClick={() => props.onSteer?.()}
              class="shrink-0"
            >
              Steer
            </Button>
          </Show>
          <Button
            aria-label="Remove queued message"
            tooltip="Remove queued message"
            variant="ghost"
            size="icon-sm"
            disabled={props.disabled}
            onClick={() => props.onRemove()}
            class="shrink-0"
          >
            <XIcon class="size-3.5" />
          </Button>
        </div>
      </div>
    </Surface>
  );
}

/**
 * The editable body of an open prompt row: the same Lexical markdown
 * surface as the composer's input, minus its send machinery. Enter saves and
 * closes, Escape restores the saved text and closes, and focus leaving the
 * editor saves whatever is there.
 */
function PromptBody(
  props: QueuedRowProps & {
    onDraftChange: (text: string) => void;
    onClose: () => void;
  }
) {
  // The last text this row and the server agree on: what was mounted,
  // applied from a server snapshot, or handed to `onEdit`. Save, restore and
  // the anti-clobber check all compare against it.
  let synced = stripAgentContext(props.item.prompt ?? '');
  // The editor's own serialization of `synced`, taken as the row opens. It
  // can differ from `synced` in markup alone, so a save compares against it
  // to tell a real edit from an untouched round trip. After the editor is
  // set from outside (a restore, a server snapshot) it is unknown until the
  // editor reports the applied text through `onChange`: that report comes
  // during `setMarkdown` outside a Lexical update, later inside one (an
  // Escape command) or inside a Solid effect, and not at all when the
  // written-out text is unchanged. So it is cleared before the set, never
  // after, and a caller that can read the applied text reads it back.
  let baseline: string | undefined;

  const save = () => {
    if (props.disabled) return;
    const text = editor.controls.getMarkdown();
    // Restored text not applied yet, so nothing has been typed since.
    if (baseline === undefined) return;
    // An emptied row is not an edit to send — the server refuses empty
    // prompts and "delete the text" has the remove affordance for it — so
    // the saved text comes back.
    if (text.trim().length === 0) {
      restore();
      return;
    }
    if (text === baseline || text === synced) return;
    synced = text;
    baseline = text;
    // Keep the private prefix on the wire when saving the visible text.
    const raw = props.item.prompt ?? '';
    const visible = stripAgentContext(raw);
    props.onEdit(raw.slice(0, raw.length - visible.length) + text);
  };

  const restore = () => {
    if (editor.controls.getMarkdown() !== synced) {
      baseline = undefined;
      editor.controls.setMarkdown(synced);
    }
    props.onDraftChange(synced);
  };

  // The composer's features, so a queued prompt edits the way it was written.
  const editor = buildConfig('chat')
    .withAppLinkResolver(useMacroMentionLinkResolver())
    .namespace('agent-queued-prompt')
    .withMentions({ showOpenTabs: true, block: 'agent' })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .onChange((markdown) => {
      if (baseline === undefined) baseline = markdown;
      props.onDraftChange(markdown);
    })
    .onEnter((event) => {
      // Enter that confirms an IME composition is not a save.
      if (event.isComposing || event.keyCode === 229) return false;
      // On a virtual keyboard Enter is a newline, as in the composer; the
      // edit saves when focus leaves the row.
      if (isTouchDevice()) return false;
      save();
      props.onClose();
      return true;
    })
    // Below the priority of the editor's own menus (mentions, emoji, the
    // link popup), so an open menu takes the Escape and the row only closes
    // when none of them did. The builder's `onEscape` would run first.
    .use((lexical) =>
      lexical.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          event?.preventDefault();
          restore();
          props.onClose();
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    )
    .onFocusLeave({
      onStart: (event) => {
        event.preventDefault();
        save();
        props.onMoveUp();
      },
      onEnd: (event) => {
        event.preventDefault();
        save();
        props.onMoveDown();
      },
    });

  // A viewer's read-only editor refuses focus; the body takes it instead so
  // Escape still closes the row.
  let body: HTMLDivElement | undefined;
  onMount(() => {
    props.registerFocus(() => {
      baseline = editor.controls.getMarkdown();
      editor.controls.focus();
      const root = editor.lexical.getRootElement();
      if (!root?.contains(document.activeElement)) body?.focus();
    });
  });

  // A server snapshot may carry someone else's edit. Apply it only while
  // this row is untouched — never over a focused editor or unsaved local
  // changes, which are about to become the server's text anyway. Only the
  // prompt is tracked: reading the editor's text must not subscribe this
  // effect to it, or it would re-run inside the editor's own update, where
  // the set is deferred and the read below would be stale. The item itself
  // is rebuilt from every list change, so only a changed prompt counts, or
  // a just-saved edit would revert until the server echoes it.
  createEffect(
    on(
      () => props.item.prompt,
      (prompt, previous) => {
        if (prompt === previous) return;
        const server = stripAgentContext(prompt ?? '');
        if (server === synced) return;
        const root = editor.lexical.getRootElement();
        const focused = root?.contains(document.activeElement) ?? false;
        const dirty = editor.controls.getMarkdown() !== synced;
        if (focused || dirty) return;
        baseline = undefined;
        editor.controls.setMarkdown(server);
        // The set has applied (this effect never runs inside a Lexical
        // update), and a snapshot the editor writes out unchanged reports
        // no change at all, so read the applied text back here.
        if (baseline === undefined) baseline = editor.controls.getMarkdown();
        props.onDraftChange(server);
        synced = server;
      }
    )
  );

  return (
    <div
      ref={body}
      tabindex="-1"
      class="text-sm text-ink outline-none"
      onFocusOut={save}
    >
      <MarkdownShell
        config={editor}
        initialValue={stripAgentContext(props.item.prompt ?? '')}
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
