/**
 * The agent block's composer: the chat input's look and its markdown editing
 * surface (`MarkdownShell` over a lean `EditorConfigBuilder`), including `@`
 * mentions so users can attach Macro items the same way they do in chat.
 * Attachments, upload queue, and chat contexts stay out; model plumbing
 * arrives through the `modelControl` slot. Visual chrome mirrors
 * `@core/component/AI/component/input/ChatInput.tsx`.
 */

import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import type { AgentCommandItem } from '@core/component/LexicalMarkdown/plugins';
import { focusDebugLog } from '@core/debug/focusDebugLog';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { $insertReferencedPaste } from '@macro-inc/lexical-core';
import EnterIcon from '@phosphor-icons/core/regular/arrow-bend-down-left.svg?component-solid';
import { Button, SendButton, Surface } from '@ui';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

/** Quote text into the composer as a referenced paste chip. */
export type QuoteInsert = (text: string) => void;

export interface AgentInputProps {
  placeholder?: string;
  /** The agent is working: the send button becomes a stop square. */
  busy?: boolean;
  /**
   * A waiting action can be advanced by ending the current turn. While the
   * input is empty, Enter and the matching button do exactly that.
   */
  hasQueuedMessages?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  /**
   * Slash commands the harness advertises (ACP `available_commands_update`);
   * typing `/` opens a typeahead over them. `/` stays plain text while empty.
   */
  commands?: () => AgentCommandItem[];
  /** Receives the composed markdown, including any `<m-document-mention>` tags. */
  onSend: (markdown: string) => void;
  onStop?: () => void;
  /** Model control: a pill above the box on desktop, footer-left on touch. */
  modelControl?: JSX.Element;
  /**
   * Ref-style: receives the quote-insert function once the editor mounts
   * (and `undefined` again on unmount), so the transcript's "Reply to this"
   * chip can quote selected text into this composer.
   */
  registerQuoteInsert?: (insert: QuoteInsert | undefined) => void;
  /**
   * Up (or Shift+Tab/Left, the app's focus-leave convention) at the very
   * start of the input: focus moves to whatever sits above — the queued
   * prompt about to dispatch. Ordinary in-text cursor movement never
   * triggers it.
   */
  onNavigateUp?: () => void;
  /** Ref-style: how the queue's Down-past-the-end refocuses this input;
   *  `undefined` again on unmount. */
  registerFocus?: (focus: (() => void) | undefined) => void;
}

/** Past this height a phone draft is scroll-capped so it cannot eat the dock. */
const SINGLE_LINE_HEIGHT = 40;

export function AgentInput(props: AgentInputProps) {
  const [markdown, setMarkdown] = createSignal('');
  let containerRef: HTMLDivElement | undefined;
  let bodyRef: HTMLDivElement | undefined;
  useTouchOutsideToDismissKeyboard(() => containerRef);

  // Sending while busy is allowed — the service queues prompts behind the
  // running turn.
  const canSend = () => markdown().trim().length > 0 && !props.disabled;

  // Caps tall drafts on a phone so the editor cannot eat the viewport
  // above the dock. Controls live in a footer row, not over the text.
  const isMultiline = () => {
    if (markdown().trim().length === 0) return false;
    if (!bodyRef) return false;
    return bodyRef.scrollHeight > SINGLE_LINE_HEIGHT;
  };

  const send = () => {
    if (!canSend()) return;
    const content = markdown().trim();
    editor.controls.clear();
    props.onSend(content);
  };

  const canSendNext = () =>
    markdown().trim().length === 0 &&
    props.busy &&
    props.hasQueuedMessages &&
    !props.disabled &&
    props.onStop !== undefined;

  const sendNext = () => {
    if (!canSendNext()) return;
    // Stop bypasses the server queue. The cancelled turn ending immediately
    // dispatches its oldest waiting action, so the queue remains FIFO.
    props.onStop?.();
  };

  const editor = buildConfig('chat')
    .namespace('agent-input')
    .withMentions({
      showOpenTabs: true,
      block: 'agent',
    })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withAgentCommands({ commands: () => props.commands?.() ?? [] })
    .onEnter(() => {
      if (canSend()) send();
      else sendNext();
      return true;
    })
    .onFocusLeave({
      onStart: (event) => {
        if (!props.onNavigateUp) return;
        event.preventDefault();
        props.onNavigateUp();
      },
      // Nothing sits below the input; the key keeps its default behavior.
      onEnd: () => {},
    })
    .onChange(setMarkdown);

  onMount(() => {
    // #region agent log
    focusDebugLog({
      hypothesisId: 'H1,H4',
      location: 'AgentInput.tsx:onMount',
      message: 'agent input focus plumbing mounted',
      data: {
        hasRegisterFocus: props.registerFocus !== undefined,
        hasModelControl: props.modelControl !== undefined,
      },
    });
    // #endregion
    props.registerFocus?.(() => {
      // #region agent log
      focusDebugLog({
        hypothesisId: 'H4',
        location: 'AgentInput.tsx:registeredFocus',
        message: 'editor focus command invoked',
        data: {
          activeTagBefore: document.activeElement?.tagName ?? null,
          connectedContentEditableCount: document.querySelectorAll(
            '[contenteditable="true"]'
          ).length,
        },
      });
      // #endregion
      editor.controls.focus();
    });
    onCleanup(() => props.registerFocus?.(undefined));
    props.registerQuoteInsert?.((text) => {
      // Discrete so the chip is committed to the DOM before focus moves in.
      editor.lexical.update(() => $insertReferencedPaste(text), {
        discrete: true,
      });
      editor.controls.focus();
    });
    onCleanup(() => props.registerQuoteInsert?.(undefined));
  });

  // MarkdownShell only focuses on click when !isMobile(), so padding taps
  // on a phone miss the empty contenteditable. Focus from this gesture
  // (channel EditorShell / chat surface) so the whole box is tappable,
  // including on touch — pointerdown stays inside the user gesture that
  // iOS needs to raise the keyboard.
  const focusEditor = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) return;
    editor.controls.focus();
  };

  return (
    <div ref={containerRef} data-keep-keyboard class="flex flex-col gap-1.5">
      {/* Desktop: the model pill sits above the box, as it always has. */}
      <Show when={!isTouchDevice() && props.modelControl}>
        <div class="flex items-center px-0.5">{props.modelControl}</div>
      </Show>
      {/* h-auto beats Surface's size-full so the in-flow controls are not
          clipped over the editor (that was Auto sitting on the placeholder). */}
      <Surface class="rounded-xl touch:rounded-2xl h-auto" depth={2} solid>
        {/* Desktop: one row, send right of the text. Touch: the text gets
            the whole width and the controls drop to a footer row (model
            left, send right) — the chat-tall / channel footer shape. */}
        <div
          class="flex items-end gap-1 px-2 py-1.5 touch:flex-col touch:items-stretch touch:gap-1.5 touch:px-3 touch:pt-2.5 touch:pb-2"
          onPointerDown={focusEditor}
        >
          {/* No vertical padding of its own: the shell is min-h-8 and editor
            paragraphs carry my-1.5, so the row's py-1.5 is the whole frame —
            the same 44px single-line height as ChatInput. */}
          <div
            ref={bodyRef}
            class="min-w-0 flex-1 pl-1 text-sm text-ink touch:pl-0 touch:text-base"
            classList={{
              // While empty only the placeholder renders; keep it to one clipped
              // line so it doesn't wrap into the single-line height.
              'overflow-hidden whitespace-nowrap':
                markdown().trim().length === 0,
              // Long drafts must not eat the mobile viewport above the dock.
              'max-h-[calc(32*var(--dvh,1dvh))] overflow-y-auto':
                isMultiline() && isMobile(),
            }}
          >
            <MarkdownShell
              config={editor}
              placeholder={
                props.placeholder ?? 'Message the agent, @mention anything'
              }
              autofocus={props.autofocus}
            />
          </div>

          {/* In-flow — never absolute over the text. */}
          <div class="flex shrink-0 items-center gap-1 pb-0.5 touch:pb-0">
            <Show when={isTouchDevice() && props.modelControl}>
              <div class="min-w-0">{props.modelControl}</div>
            </Show>
            <div class="ml-auto shrink-0">
              <Show
                when={props.busy && props.onStop}
                fallback={
                  <SendButton
                    tooltip="Send"
                    disabled={!canSend()}
                    onClick={send}
                  />
                }
              >
                <Show
                  when={canSendNext()}
                  fallback={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      label="Stop"
                      onClick={() => props.onStop?.()}
                      class="rounded-[11px] size-7.5 text-ink-extra-muted not-disabled:bg-ink/5 not-disabled:hover:bg-ink/10"
                    >
                      <div class="size-3.5 rounded-sm bg-current" />
                    </Button>
                  }
                >
                  <SendButton
                    aria-label="Send next queued message"
                    tooltip="Send next queued message"
                    shortcut="Enter"
                    onClick={sendNext}
                  >
                    <EnterIcon />
                  </SendButton>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </Surface>
    </div>
  );
}
