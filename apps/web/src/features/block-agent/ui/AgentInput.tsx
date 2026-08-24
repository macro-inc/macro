/**
 * The agent block's composer: the chat input's look and its markdown editing
 * surface (`MarkdownShell` over a lean `EditorConfigBuilder`), without the
 * rest of `ChatInput`'s machinery — no mentions, attachments, upload queue,
 * model plumbing, or contexts. Visual chrome mirrors
 * `@core/component/AI/component/input/ChatInput.tsx`.
 */

import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { Button, SendButton, Surface } from '@ui';
import { createSignal, Show } from 'solid-js';

export interface AgentInputProps {
  placeholder?: string;
  /** The agent is working: the send button becomes a stop square. */
  busy?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  /** Receives the composed markdown. */
  onSend: (markdown: string) => void;
  onStop?: () => void;
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
    .onEnter(() => {
      send();
      return true;
    })
    .onChange(setMarkdown);

  return (
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
            'overflow-hidden whitespace-nowrap': markdown().trim().length === 0,
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
              <SendButton tooltip="Send" disabled={!canSend()} onClick={send} />
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
  );
}
