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
import { getAttachmentKindFromFile } from '@channel/Input/utils/file-helpers';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { preloadAgentFold } from '@core/agent-fold/client';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import {
  TYPE_AGENT_COMMAND_SYMBOL_COMMAND,
  TYPE_AT_SYMBOL_COMMAND,
  TYPE_SKILL_SYMBOL_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { createComposerLayout } from '@core/component/LexicalMarkdown/utils/create-composer-layout';
import { toast } from '@core/component/Toast/Toast';
import { hapticImpact } from '@core/mobile/haptics';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { fireAndForget } from '@core/util/fireAndForget';
import { handleFileFolderDrop } from '@core/util/upload';
import { $insertReferencedPaste } from '@macro-inc/lexical-core';
import { makeEventListener } from '@solid-primitives/event-listener';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, ComposerSurface, SendButton } from '@ui';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
} from 'lexical';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { IMAGE_INPUT_WARNING } from '../../block-agent/state/image-input';
import { AgentComposerAddMenu } from '../views/ComposerAddMenu';

/** Shared input that starts on one line and grows with the draft. */
export function ChatComposer(props: {
  autoFocus?: boolean;
  collapseOnBlur?: boolean;
  /** Portaled controls retain their anchor when focus leaves the composer. */
  controlsOpen?: boolean;
  registerFocus?: (focus: () => void) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  blockedReason?: string;
  supportsImages?: boolean | null;
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
  const attachments = () => props.attachments ?? [];
  const hasContent = () => !!props.draft.trim() || attachments().length > 0;
  const hasPendingAttachments = () =>
    attachments().some((file) => file.pending);
  const hasUnsupportedImages = () =>
    props.supportsImages === false &&
    attachments().some((file) => file.kind === 'image');
  const canAttach = () => !!props.onAttachFiles && !disabled();
  const attachFiles = (files: File[]) => {
    if (!canAttach() || files.length === 0) return;
    const accepted =
      props.supportsImages === false
        ? files.filter((file) => getAttachmentKindFromFile(file) !== 'image')
        : files;
    if (accepted.length !== files.length) toast.failure(IMAGE_INPUT_WARNING);
    if (accepted.length) props.onAttachFiles?.(accepted);
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
    // Content held offscreen by a pending Suspense reports 0; pinning that
    // would animate the surface up from nothing once it attaches.
    if (!element.isConnected) return;
    setHeight(element.getBoundingClientRect().height);
  });
  let container: HTMLDivElement | undefined;
  const [focused, setFocused] = createSignal(false);
  const [hasFocused, setHasFocused] = createSignal(false);
  const collapsed = () =>
    isTouchDevice() &&
    props.collapseOnBlur &&
    !focused() &&
    !props.controlsOpen;
  const drawerOpen = () => props.drawerOpen && !collapsed();
  useTouchOutsideToDismissKeyboard(() => container);
  const disabled = () => !!props.blockedReason || props.session?.disabled;
  const canSendNext = () =>
    !hasContent() &&
    !props.session?.sendNextHeld &&
    props.session?.hasQueuedMessages &&
    props.session.onStop &&
    !disabled();
  const editor = buildConfig('chat')
    .withAppLinkResolver(useMacroMentionLinkResolver())
    .namespace('agents-chat-composer')
    .withMentions({ showOpenTabs: true, block: 'agent' })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withFilePaste({
      onPasteFilesAndDirs: (files, directories) => {
        fireAndForget(
          handleFileFolderDrop(files, directories, (entries) =>
            attachFiles(entries.map((entry) => entry.file))
          ),
          'agents-view'
        );
      },
    })
    .onEnter((_event, markdown) => {
      // On a virtual keyboard Enter is a newline, as in channels; the send
      // button is the only way to submit.
      if (isTouchDevice()) return false;
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
    mode: () =>
      collapsed()
        ? 'collapsed'
        : isTouchDevice() && (props.collapseOnBlur || focused())
          ? 'expanded'
          : 'auto',
  });

  // Apply host-supplied drafts (Home suggestions) to the existing editor.
  createEffect(() => {
    if (props.draft !== editor.controls.getMarkdown())
      editor.controls.setMarkdown(props.draft);
  });

  onMount(() => {
    if (props.collapseOnBlur) {
      makeEventListener(document, 'pointerdown', (event) => {
        if (event.target instanceof Node && !container?.contains(event.target))
          setFocused(false);
      });
    }
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
      hasUnsupportedImages() ||
      dictation.active() ||
      disabled()
    )
      return;
    const attached = attachments();
    editor.controls.clear();
    props.onDraftChange('');
    hapticImpact('light');
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
    // Solid delegates events from popups the editor portals out of the
    // composer (the paste viewer) through here; cancelling them blocks
    // selecting their text.
    if (!(event.currentTarget as Node).contains(target)) return;
    if (editor.lexical.getRootElement()?.contains(target)) return;
    event.preventDefault();
    if (event.type === 'pointerdown') editor.controls.focus();
  };

  const openTypeahead = (kind: 'library' | 'skills') => {
    editor.lexical.focus(() => {
      editor.lexical.update(
        () => {
          if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const node = selection.anchor.getNode();
          const preceding = $isTextNode(node)
            ? node
                .getTextContent()
                .slice(selection.anchor.offset - 1, selection.anchor.offset)
            : '';
          if (preceding && !/\s/.test(preceding)) selection.insertText(' ');
        },
        {
          discrete: true,
          onUpdate: () =>
            editor.lexical.dispatchCommand(
              kind === 'library'
                ? TYPE_AT_SYMBOL_COMMAND
                : props.session
                  ? TYPE_AGENT_COMMAND_SYMBOL_COMMAND
                  : TYPE_SKILL_SYMBOL_COMMAND,
              undefined
            ),
        }
      );
    });
  };

  const editorRow = () => (
    <div
      classList={{
        'max-h-6 overflow-hidden': !!collapsed(),
        'max-h-[min(15rem,30dvh)]': !collapsed(),
      }}
      class="min-w-0 flex-1 self-center overflow-y-auto px-[9.375px] not-touch:group-data-[composer-compact=false]/composer:px-1.5 group-data-[composer-compact=true]/composer:px-0 group-data-[composer-coding=true]/composer:min-h-[58px] touch:group-data-[composer-compact=false]/composer:min-h-18 group-data-[composer-compact=false]/composer:flex-none group-data-[composer-compact=false]/composer:basis-full"
    >
      <MarkdownShell
        class="h-auto min-h-6 text-base leading-6 [&_[data-markdown-editable]]:min-h-6 [&_[data-markdown-editable]]:outline-none [&_[data-markdown-editable]>.md-p]:my-0 [&_[data-markdown-placeholder]]:max-w-full [&_[data-markdown-placeholder]>p]:m-0 [&_[data-markdown-placeholder]>p]:truncate"
        config={editor}
        initialValue={props.draft}
        placeholder={
          isTouchDevice()
            ? // Phones are too narrow for the full mention and skills hint.
              'Message Macro AI'
            : (props.placeholder ??
              'Type @ to mention docs, people, or channels, / for skills')
        }
        ariaLabel="Message the agent"
        autofocus={
          !isTouchDevice() &&
          (props.autoFocus ?? props.session?.autofocus ?? true)
        }
      />
    </div>
  );

  const repositoryDrawer = () => (
    <Show when={props.drawer}>
      <div
        class="composer-drawer"
        data-placement={isTouchDevice() ? 'top' : 'bottom'}
        data-open={drawerOpen() ? '' : undefined}
        aria-hidden={!drawerOpen()}
        inert={!drawerOpen()}
      >
        <div class="composer-drawer-inner">
          <div
            class="composer-drawer-content"
            role="group"
            aria-label="Conversation settings"
          >
            {props.drawer}
          </div>
        </div>
      </div>
    </Show>
  );

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
      <div
        ref={container}
        data-keep-keyboard
        class="relative w-full min-w-0 touch:island touch:rounded-[32px]"
        onFocusIn={(event) => {
          // Focusing a control before its click must not move it into the
          // expanded layout midway through a tap.
          if (
            event.target instanceof Element &&
            event.target.closest(
              '[data-composer-controls], button, input, select, a'
            )
          )
            return;
          setFocused(true);
          setHasFocused(true);
          fireAndForget(preloadAgentFold(), 'agents-view');
        }}
        onFocusOut={(event) => {
          // iOS control taps can blur with no relatedTarget before click.
          // Collapse only for a known outside focus or pointer interaction.
          if (
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            setFocused(false);
        }}
      >
        <Show when={isTouchDevice()}>{repositoryDrawer()}</Show>
        <ComposerSurface
          as="div"
          data-agent-composer="chat"
          data-composer-expanded={
            (isTouchDevice() && !collapsed()) || undefined
          }
          class="relative z-10 min-w-0 rounded-[28px] touch:rounded-[32px] transition-[height] duration-200 ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
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
                class="rounded-[28px] touch:rounded-[32px]"
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
              {/* Desktop expanded text uses an 18px horizontal inset and 16px
                  top padding; touch keeps the compact row's vertical inset. */}
              <div
                ref={setLayout}
                data-composer-compact={!drawerOpen() && isCompact()}
                data-composer-coding={drawerOpen() || undefined}
                data-composer-collapsed={collapsed() || undefined}
                class="group/composer flex min-w-0 data-[composer-compact=false]:flex-wrap items-end gap-2 p-[7.5px] pl-3 data-[composer-compact=false]:pb-2.5 data-[composer-compact=false]:px-3 data-[composer-compact=false]:pt-[calc(7.5px_+_(33.75px_-_1.5rem)/2)] not-touch:data-[composer-compact=false]:pt-4 data-[composer-collapsed=true]:h-(--mobile-chrome-button-size) data-[composer-collapsed=true]:items-center data-[composer-collapsed=true]:py-0 data-[composer-collapsed=true]:pl-3.5 data-[composer-collapsed=true]:pr-[9.5px]"
              >
                <Show when={props.onAttachFiles}>
                  <div
                    data-composer-controls
                    classList={{ hidden: !!collapsed() }}
                    class="shrink-0 group-data-[composer-compact=false]/composer:order-1"
                  >
                    <Input.AttachFilesAction
                      accept={null}
                      disabled={disabled()}
                      trigger={(openFiles) => (
                        <AgentComposerAddMenu
                          openFiles={openFiles}
                          openLibrary={() => openTypeahead('library')}
                          openSkills={() => openTypeahead('skills')}
                          getEditor={() => editor.lexical.getRootElement()}
                          session={!!props.session}
                          disabled={disabled()}
                        />
                      )}
                    />
                  </div>
                </Show>
                {editorRow()}
                <div
                  data-composer-controls
                  class="order-2 flex min-w-0 max-w-[55%] group-data-[composer-compact=false]/composer:max-w-none group-data-[composer-compact=false]/composer:flex-1 shrink-0 items-center gap-2"
                  role="group"
                  aria-label="Composer settings"
                >
                  <div class="ml-auto flex min-w-0 max-w-full items-center gap-2 [&_.menu]:right-0 [&_.menu]:left-auto [&_.menu-anchor]:min-w-0 [&_.pill]:max-w-full">
                    <div
                      class={
                        collapsed() || (isTouchDevice() && !hasFocused())
                          ? 'hidden'
                          : 'flex min-w-0 items-center gap-2'
                      }
                    >
                      {props.selector}
                      <div class={collapsed() ? 'hidden' : 'contents'}>
                        <DictationButton
                          dictation={dictation}
                          disabled={disabled()}
                        />
                      </div>
                    </div>
                    <Show
                      when={
                        (props.session?.busy || canSendNext()) &&
                        props.session?.onStop &&
                        !hasContent()
                      }
                      fallback={
                        <SendButton
                          appearance="composer"
                          class="touch:bg-transparent touch:text-ink touch:data-disabled:bg-transparent"
                          aria-label="Send"
                          title={props.blockedReason}
                          disabled={
                            !hasContent() ||
                            hasPendingAttachments() ||
                            hasUnsupportedImages() ||
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
                            class="touch:glass touch:bg-chrome touch:text-ink touch:data-disabled:bg-chrome"
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
                          class="touch:bg-transparent touch:text-ink touch:data-disabled:bg-transparent"
                          intent="flush"
                          aria-label="Flush queued messages"
                          tooltip="Flush queued messages"
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
        <Show when={props.supportsImages === false}>
          <p role="status" class="px-3 py-1 text-xs text-ink-muted">
            {IMAGE_INPUT_WARNING}
          </p>
        </Show>
        <Show when={!isTouchDevice()}>{repositoryDrawer()}</Show>
        <DictationFeedback dictation={dictation} />
      </div>
    </InputProvider>
  );
}

/** Adapt the session's controls to the same input used for a new Chat. */
export function ChatSessionInput(props: AgentInputProps) {
  const [owned, setOwned] = createSignal(props.initialInput ?? '');
  const controlled = () => props.onDraftChange !== undefined;
  const draft = () => (controlled() ? (props.draft ?? '') : owned());
  const setDraft = (value: string) => {
    if (props.onDraftChange) props.onDraftChange(value);
    else setOwned(value);
  };
  return (
    <ChatComposer
      draft={draft()}
      onDraftChange={setDraft}
      selector={props.modelControl}
      onSend={props.onSend}
      session={props}
      supportsImages={props.supportsImages}
      attachments={props.attachments}
      onAttachFiles={props.onAttachFiles}
      onRemoveAttachment={props.onRemoveAttachment}
    />
  );
}
