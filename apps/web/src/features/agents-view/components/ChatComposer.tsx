import type { AgentInputProps } from '@app/features/block-agent/ui';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { $insertReferencedPaste } from '@macro-inc/lexical-core';
import { Button, ComposerSurface, SendButton } from '@ui';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { createChatComposerTip } from '../primitives/chat-composer-tip';

/** Chat owns its editor and sizing; Code's composer has a separate layout. */
export function ChatComposer(props: {
  draft: string;
  onDraftChange: (draft: string) => void;
  blockedReason?: string;
  agentSelector?: JSX.Element;
  modelSelector: JSX.Element;
  onSend: (prompt: string) => void;
  session?: AgentInputProps;
}) {
  const tip = createChatComposerTip(
    () => props.draft.trim().length === 0,
    !props.session
  );
  let container: HTMLDivElement | undefined;
  useTouchOutsideToDismissKeyboard(() => container);
  const disabled = () => !!props.blockedReason || props.session?.disabled;
  const canSendNext = () =>
    !props.draft.trim() &&
    props.session?.busy &&
    props.session.hasQueuedMessages &&
    props.session.onStop &&
    !disabled();
  const editor = buildConfig('chat')
    .namespace('agents-chat-composer')
    .withMentions({ showOpenTabs: true, block: 'agent' })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .onEnter((_event, markdown) => {
      if (markdown.trim()) send(markdown);
      else if (canSendNext()) props.session?.onStop?.();
      return true;
    })
    .onFocusLeave({
      onStart: (event) => {
        if (!props.session?.onNavigateUp) return;
        event.preventDefault();
        props.session.onNavigateUp();
      },
      onEnd: () => {},
    })
    .onChange(props.onDraftChange);

  if (props.session) {
    editor.withAgentCommands({
      commands: () => props.session?.commands?.() ?? [],
    });
  } else {
    editor.withSkills();
  }

  onMount(() => {
    props.session?.registerFocus?.(() => editor.controls.focus());
    props.session?.registerQuoteInsert?.((text) => {
      editor.lexical.update(() => $insertReferencedPaste(text), {
        discrete: true,
      });
      editor.controls.focus();
    });
    onCleanup(() => {
      props.session?.registerFocus?.(undefined);
      props.session?.registerQuoteInsert?.(undefined);
    });
  });

  const send = (markdown = editor.controls.getMarkdown()) => {
    const prompt = markdown.trim();
    if (!prompt || disabled()) return;
    editor.controls.clear();
    props.onDraftChange('');
    props.onSend(prompt);
  };

  const focusEditor = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button')) return;
    if (editor.lexical.getRootElement()?.contains(target)) return;
    event.preventDefault();
    if (event.type === 'pointerdown') editor.controls.focus();
  };

  return (
    <div ref={container} data-keep-keyboard class="min-w-0">
      <div
        class="mb-2 flex flex-wrap items-center gap-1"
        role="group"
        aria-label="Chat settings"
      >
        {props.agentSelector}
        {props.modelSelector}
      </div>
      <ComposerSurface
        as="div"
        data-agent-composer="chat"
        class="flex min-w-0 items-end gap-3 px-4 py-2.5"
        onPointerDown={focusEditor}
        onMouseDown={focusEditor}
      >
        <div class="max-h-60 min-w-0 flex-1 self-center overflow-y-auto py-1">
          <MarkdownShell
            class="h-auto min-h-6 text-base leading-6 [&_[data-markdown-editable]]:min-h-6 [&_[data-markdown-editable]]:outline-none [&_[data-markdown-editable]>.md-p]:my-0 [&_[data-markdown-placeholder]]:max-w-full [&_[data-markdown-placeholder]>p]:m-0 [&_[data-markdown-placeholder]>p]:truncate"
            config={editor}
            initialValue={props.draft}
            placeholder={tip()}
            refFn={(element) =>
              element.setAttribute('aria-label', 'Message the agent')
            }
            autofocus={!isTouchDevice() && (props.session?.autofocus ?? true)}
          />
        </div>
        <Show
          when={
            props.session?.busy && props.session.onStop && !props.draft.trim()
          }
          fallback={
            <SendButton
              appearance="composer"
              aria-label="Send"
              title={props.blockedReason}
              disabled={!props.draft.trim() || disabled()}
              onClick={() => send()}
            />
          }
        >
          <Show
            when={canSendNext()}
            fallback={
              <Button
                variant="strong"
                size="icon-composer"
                label="Stop"
                disabled={disabled()}
                onClick={() => props.session?.onStop?.()}
              >
                <div class="size-3.5 rounded-sm bg-current" />
              </Button>
            }
          >
            <SendButton
              appearance="composer"
              aria-label="Send next queued message"
              tooltip="Send next queued message"
              shortcut="Enter"
              onClick={() => props.session?.onStop?.()}
            />
          </Show>
        </Show>
      </ComposerSurface>
    </div>
  );
}

/** Adapt the session's controls to the same input used for a new Chat. */
export function ChatSessionInput(props: AgentInputProps) {
  const [draft, setDraft] = createSignal('');
  return (
    <ChatComposer
      draft={draft()}
      onDraftChange={setDraft}
      modelSelector={props.modelControl}
      onSend={props.onSend}
      session={props}
    />
  );
}
