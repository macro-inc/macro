import type { AgentInputProps } from '@app/features/block-agent/ui';
import {
  DictationButton,
  DictationFeedback,
  DictationPanel,
} from '@app/features/dictation/components/dictation-controls';
import { createComposerDictation } from '@app/features/dictation/composer-dictation';
import { InputProvider } from '@channel/Input/context';
import { Input } from '@channel/Input/Input';
import type { InputAttachmentData, InputCommands } from '@channel/Input/types';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { createComposerLayout } from '@core/component/LexicalMarkdown/utils/create-composer-layout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { handleFileFolderDrop } from '@core/util/upload';
import { $insertReferencedPaste } from '@macro-inc/lexical-core';
import PlusIcon from '@phosphor/plus.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, ComposerSurface, SendButton } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createChatComposerTip } from '../primitives/chat-composer-tip';

/** Shared input that starts on one line and grows with the draft. */
export function ChatComposer(props: {
  autoFocus?: boolean;
  registerFocus?: (focus: () => void) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  blockedReason?: string;
  selector: JSX.Element;
  onSend: (prompt: string, attachments: InputAttachmentData[]) => void;
  session?: AgentInputProps;
  attachments?: InputAttachmentData[];
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment?: (attachment: InputAttachmentData) => void;
  drawer?: JSX.Element;
  drawerOpen?: boolean;
  placeholder?: string;
}) {
  const tip = createChatComposerTip(
    () => props.draft.trim().length === 0,
    !props.session
  );
  const attachments = () => props.attachments ?? [];
  const hasContent = () => !!props.draft.trim() || attachments().length > 0;
  const hasPendingAttachments = () =>
    attachments().some((file) => file.pending);
  const canAttach = () => !!props.onAttachFiles && !disabled();
  const attachFiles = (files: File[]) => {
    if (canAttach() && files.length > 0) props.onAttachFiles?.(files);
  };
  const [isDraggedOver, setIsDraggedOver] = createSignal(false);
  const inputCommands: InputCommands = {
    send: async () => false,
    attachFiles: async (files) => attachFiles(files),
    removeAttachment: (attachment) => props.onRemoveAttachment?.(attachment),
    toggleFormatRibbon: () => {},
    close: () => {},
  };
  const [content, setContent] = createSignal<HTMLDivElement>();
  const [layout, setLayout] = createSignal<HTMLDivElement>();
  const [height, setHeight] = createSignal<number>();
  createResizeObserver(content, (_, element) => {
    setHeight(element.getBoundingClientRect().height);
  });
  let container: HTMLDivElement | undefined;
  useTouchOutsideToDismissKeyboard(() => container);
  const disabled = () => !!props.blockedReason || props.session?.disabled;
  const canSendNext = () =>
    !hasContent() &&
    !props.session?.sendNextHeld &&
    props.session?.hasQueuedMessages &&
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
    .withFilePaste({
      onPasteFilesAndDirs: (files, directories) => {
        void handleFileFolderDrop(files, directories, (entries) =>
          attachFiles(entries.map((entry) => entry.file))
        );
      },
    })
    .onEnter((_event, markdown) => {
      if (markdown.trim() || attachments().length > 0) send(markdown);
      else if (canSendNext()) sendNext();
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

  const dictation = createComposerDictation(() => editor.lexical);

  const { isCompact } = createComposerLayout(editor.buildHandle().lexical, {
    container: layout,
  });

  // Apply host-supplied drafts (Home suggestions) to the existing editor.
  createEffect(() => {
    if (props.draft !== editor.controls.getMarkdown())
      editor.controls.setMarkdown(props.draft);
  });

  onMount(() => {
    props.registerFocus?.(() => editor.controls.focus());
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
    if (
      (!prompt && attachments().length === 0) ||
      hasPendingAttachments() ||
      dictation.active() ||
      disabled()
    )
      return;
    const attached = attachments();
    editor.controls.clear();
    props.onDraftChange('');
    props.onSend(prompt, attached);
  };

  const sendNext = () => {
    if (canSendNext()) (props.session?.onSendNext ?? props.session?.onStop)?.();
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
    <InputProvider
      value={{
        view: () => ({
          mode: 'channel',
          attachments: attachments(),
          isDraggedOver: isDraggedOver(),
          hasPendingAttachments: hasPendingAttachments(),
        }),
        commands: inputCommands,
      }}
    >
      <div ref={container} data-keep-keyboard class="min-w-0">
        <ComposerSurface
          as="div"
          data-agent-composer="chat"
          class="relative z-10 min-w-0 rounded-[32px] transition-[height] duration-200 ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
          style={{
            height: height() === undefined ? undefined : `${height()}px`,
          }}
          onPointerDown={focusEditor}
          onMouseDown={focusEditor}
        >
          <Input.DropZone
            onDragStart={(valid) => canAttach() && setIsDraggedOver(valid)}
            onDragEnd={() => setIsDraggedOver(false)}
          >
            <Show when={canAttach()}>
              <Input.DropOverlay
                class="rounded-[32px]"
                hint="Drop files here to send them to the agent"
              />
            </Show>
            <div
              ref={setContent}
              data-composer-content
              inert={dictation.active()}
              classList={{ invisible: dictation.active() }}
            >
              <Input.Attachments kind="media" class="pb-0" />
              <Input.Attachments kind="document" class="pb-0" />
              {/* Expanded text keeps the compact row's vertical inset:
                  7.5px padding + half the button/line-height difference. */}
              <div
                ref={setLayout}
                data-composer-compact={!props.drawerOpen && isCompact()}
                data-composer-coding={props.drawerOpen || undefined}
                class="group/composer flex min-w-0 data-[composer-compact=false]:flex-wrap items-end gap-2 p-[7.5px] pl-3 data-[composer-compact=false]:pb-2.5 data-[composer-compact=false]:px-3 data-[composer-compact=false]:pt-[calc(7.5px_+_(33.75px_-_1.5rem)/2)]"
              >
                <Show when={props.onAttachFiles}>
                  <div
                    data-composer-controls
                    class="shrink-0 group-data-[composer-compact=false]/composer:order-1"
                  >
                    <Input.AttachFilesAction
                      accept={null}
                      disabled={disabled()}
                    >
                      <PlusIcon />
                    </Input.AttachFilesAction>
                  </div>
                </Show>
                <div class="max-h-60 min-w-0 flex-1 self-center group-data-[composer-compact=false]/composer:flex-none group-data-[composer-compact=false]/composer:basis-full overflow-y-auto px-[9.375px] group-data-[composer-compact=true]/composer:px-0 group-data-[composer-coding=true]/composer:min-h-[58px]">
                  <MarkdownShell
                    class="h-auto min-h-6 text-base leading-6 [&_[data-markdown-editable]]:min-h-6 [&_[data-markdown-editable]]:outline-none [&_[data-markdown-editable]>.md-p]:my-0 [&_[data-markdown-placeholder]]:max-w-full [&_[data-markdown-placeholder]>p]:m-0 [&_[data-markdown-placeholder]>p]:truncate"
                    config={editor}
                    initialValue={props.draft}
                    placeholder={props.placeholder ?? tip()}
                    refFn={(element) =>
                      element.setAttribute('aria-label', 'Message the agent')
                    }
                    autofocus={
                      !isTouchDevice() &&
                      (props.autoFocus ?? props.session?.autofocus ?? true)
                    }
                  />
                </div>
                <div
                  data-composer-controls
                  class="order-2 flex min-w-0 max-w-[55%] group-data-[composer-compact=false]/composer:max-w-none group-data-[composer-compact=false]/composer:flex-1 shrink-0 items-center gap-2"
                  role="group"
                  aria-label="Composer settings"
                >
                  <div class="ml-auto flex min-w-0 max-w-full items-center gap-2 [&_.menu]:right-0 [&_.menu]:left-auto [&_.menu-anchor]:min-w-0 [&_.pill]:max-w-full">
                    {props.selector}
                    <DictationButton
                      dictation={dictation}
                      disabled={disabled()}
                    />
                    <Show
                      when={
                        (props.session?.busy || canSendNext()) &&
                        props.session?.onStop &&
                        !hasContent()
                      }
                      fallback={
                        <SendButton
                          appearance="composer"
                          aria-label="Send"
                          title={props.blockedReason}
                          disabled={
                            !hasContent() ||
                            hasPendingAttachments() ||
                            disabled()
                          }
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
                          onClick={sendNext}
                        />
                      </Show>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </Input.DropZone>
          <DictationPanel dictation={dictation} />
        </ComposerSurface>
        <DictationFeedback dictation={dictation} />
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
    </InputProvider>
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
      attachments={props.attachments}
      onAttachFiles={props.onAttachFiles}
      onRemoveAttachment={props.onRemoveAttachment}
    />
  );
}
