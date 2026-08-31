/**
 * The agent block's composer: the chat input's look and its markdown editing
 * surface (`MarkdownShell` over a lean `EditorConfigBuilder`), without the
 * rest of `ChatInput`'s machinery — no mentions, attachments, upload queue,
 * or contexts; model plumbing arrives through the `modelControl` slot. Visual
 * chrome mirrors `@core/component/AI/component/input/ChatInput.tsx`.
 */

import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import type { AgentCommandItem } from '@core/component/LexicalMarkdown/plugins';
import { $insertReferencedPaste } from '@macro-inc/lexical-core';
import { Button, SendButton, Surface } from '@ui';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

/** Quote text into the composer as a referenced paste chip. */
export type QuoteInsert = (text: string) => void;

export interface AgentInputProps {
  placeholder?: string;
  /** The agent is working: the send button becomes a stop square. */
  busy?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  /**
   * Slash commands the harness advertises (ACP `available_commands_update`);
   * typing `/` opens a typeahead over them. `/` stays plain text while empty.
   */
  commands?: () => AgentCommandItem[];
  /** Receives the composed markdown. */
  onSend: (markdown: string) => void;
  onStop?: () => void;
  /** Sits as a pill above the input box, e.g. the session's model selector. */
  modelControl?: JSX.Element;
  /**
   * Ref-style: receives the quote-insert function once the editor mounts
   * (and `undefined` again on unmount), so the transcript's "Reply to this"
   * chip can quote selected text into this composer.
   */
  registerQuoteInsert?: (insert: QuoteInsert | undefined) => void;
}

/** Past this height the controls drop below the text instead of overlaying it. */
const SINGLE_LINE_HEIGHT = 40;

export function AgentInput(props: AgentInputProps) {
  const [markdown, setMarkdown] = createSignal('');
  let bodyRef: HTMLDivElement | undefined;

  // Sending while busy is allowed — the block queues prompts and flushes
  // them when the running turn settles.
  const canSend = () => markdown().trim().length > 0 && !props.disabled;

  // Same content-driven switch as ChatInput: once the editor body wraps past
  // one line, the send button stops overlaying the text and sits below it.
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

  const editor = buildConfig('chat')
    .namespace('agent-input')
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withAgentCommands({ commands: () => props.commands?.() ?? [] })
    .onEnter(() => {
      send();
      return true;
    })
    .onChange(setMarkdown);

  onMount(() => {
    props.registerQuoteInsert?.((text) => {
      // Discrete so the chip is committed to the DOM before focus moves in.
      editor.lexical.update(() => $insertReferencedPaste(text), {
        discrete: true,
      });
      editor.controls.focus();
    });
    onCleanup(() => props.registerQuoteInsert?.(undefined));
  });

  return (
    <div class="flex flex-col gap-1.5">
      {/* Above the surface rather than inside it: the pill belongs to the
          composer, not to the outlined field, so it must not eat into the
          editor's frame or sit within its border. */}
      <Show when={props.modelControl}>
        <div class="flex items-center px-0.5">{props.modelControl}</div>
      </Show>
      <Surface class="rounded-xl" depth={2} solid>
        <div class="relative px-2 py-1.5">
          {/* No vertical padding of its own: the shell is min-h-8 and editor
            paragraphs carry my-1.5, so the row's py-1.5 is the whole frame —
            the same 44px single-line height as ChatInput. */}
          <div
            ref={bodyRef}
            class="pl-1 text-sm text-ink"
            classList={{
              'pr-10': !isMultiline(),
              'pb-8': isMultiline(),
              // While empty only the placeholder renders; keep it to one clipped
              // line so it doesn't wrap into the single-line height.
              'overflow-hidden whitespace-nowrap':
                markdown().trim().length === 0,
            }}
          >
            <MarkdownShell
              config={editor}
              placeholder={props.placeholder ?? 'Message the agent'}
              autofocus={props.autofocus}
            />
          </div>

          <div class="absolute right-1.5 bottom-1.5">
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
              <Button
                variant="ghost"
                size="icon-sm"
                label="Stop"
                onClick={() => props.onStop?.()}
                class="rounded-[11px] size-7.5 text-ink-extra-muted not-disabled:bg-ink/5 not-disabled:hover:bg-ink/10"
              >
                <div class="size-3.5 rounded-sm bg-current" />
              </Button>
            </Show>
          </div>
        </div>
      </Surface>
    </div>
  );
}
