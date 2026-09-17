import type { AgentInputProps } from '@app/features/block-agent/ui';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { $insertReferencedPaste } from '@macro-inc/lexical-core';
import { Button, ComposerSurface, SendButton } from '@ui';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { createChatComposerTip } from '../primitives/chat-composer-tip';

/** Shared input that starts on one line and grows with the draft. */
export function ChatComposer(props: {
  draft: string;
  onDraftChange: (draft: string) => void;
  blockedReason?: string;
  selector: JSX.Element;
  onSend: (prompt: string) => void;
  session?: AgentInputProps;
  drawer?: JSX.Element;
  drawerOpen?: boolean;
  placeholder?: string;
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
    if (
      !target ||
      target.closest('[data-composer-controls], button, input, select, a')
    )
      return;
    if (editor.lexical.getRootElement()?.contains(target)) return;
    event.preventDefault();
    if (event.type === 'pointerdown') editor.controls.focus();
  };

  return (
    <div ref={container} data-keep-keyboard class="min-w-0">
      <ComposerSurface
        as="div"
        data-agent-composer="chat"
        class="flex min-w-0 items-end gap-2 rounded-[32px] px-4 py-3"
        onPointerDown={focusEditor}
        onMouseDown={focusEditor}
      >
        <div class="max-h-60 min-w-0 flex-1 self-center overflow-y-auto px-1">
          <MarkdownShell
            class="h-auto min-h-6 text-base leading-6 [&_[data-markdown-editable]]:min-h-6 [&_[data-markdown-editable]]:outline-none [&_[data-markdown-editable]>.md-p]:my-0 [&_[data-markdown-placeholder]]:max-w-full [&_[data-markdown-placeholder]>p]:m-0 [&_[data-markdown-placeholder]>p]:truncate"
            config={editor}
            initialValue={props.draft}
            placeholder={props.placeholder ?? tip()}
            refFn={(element) =>
              element.setAttribute('aria-label', 'Message the agent')
            }
            autofocus={!isTouchDevice() && (props.session?.autofocus ?? true)}
          />
        </div>
        <div
          data-composer-controls
          class="flex min-w-0 max-w-[55%] shrink-0 items-center"
          role="group"
          aria-label="Composer settings"
        >
          <div class="ml-auto flex min-w-0 max-w-full items-center gap-2 [&_.menu]:right-0 [&_.menu]:left-auto [&_.menu-anchor]:min-w-0 [&_.pill]:max-w-full">
            {props.selector}
            <Show
              when={
                props.session?.busy &&
                props.session.onStop &&
                !props.draft.trim()
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
          </div>
        </div>
      </ComposerSurface>
      <Show when={props.drawer}>
        <div
          class="composer-drawer"
          data-open={props.drawerOpen ? '' : undefined}
          aria-hidden={!props.drawerOpen}
          inert={!props.drawerOpen}
        >
          <div class="composer-drawer-inner">
            <div
              class="composer-drawer-content"
              role="group"
              aria-label="Repository settings"
            >
              {props.drawer}
            </div>
          </div>
        </div>
      </Show>
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
      selector={props.modelControl}
      onSend={props.onSend}
      session={props}
    />
  );
}
