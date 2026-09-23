import { createResizeObserver } from '@solid-primitives/resize-observer';
/**
 * The agent block's composer: the chat input's look and its markdown editing
 * surface (`MarkdownShell` over a lean `EditorConfigBuilder`), including `@`
 * mentions so users can attach Macro items the same way they do in chat, and
 * file attachments - drop, paste, or the paperclip - shown as the channel
 * composer's chips. Uploading itself stays out: the parent owns the
 * attachment list and hands files back through `onAttachFiles`. Model
 * plumbing arrives through the `modelControl` slot. Visual chrome mirrors
 * `@core/component/AI/component/input/ChatInput.tsx`.
 */

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
import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import type { AgentCommandItem } from '@core/component/LexicalMarkdown/plugins';
import { createComposerLayout } from '@core/component/LexicalMarkdown/utils/create-composer-layout';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { handleFileFolderDrop } from '@core/util/upload';
import { $insertReferencedPaste } from '@macro-inc/lexical-core';
import EnterIcon from '@phosphor-icons/core/regular/arrow-bend-down-left.svg?component-solid';
import { Button, ComposerSurface, SendButton } from '@ui';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

/**
 * Id of the agent input's text-area wrapper. Exposed so callers (e.g. the
 * mobile Create menu) can arm focus on the contenteditable before it mounts.
 */
export const AGENT_INPUT_TEXT_AREA_ID = 'agent-input-text-area';

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
  /**
   * Advancing the queue would not advance it right now, so Enter and the
   * button stay inert (the control reads Stop). Either a stop is already on
   * its way - the queue advances when the turn it ends actually ends, so a
   * second stop does nothing but post again - or the prompt that last
   * advanced is still unconfirmed, so there is no turn the server has opened
   * for a stop to end.
   */
  sendNextHeld?: boolean;
  /**
   * Enter or the send button with an empty input and a queued message. Falls
   * back to `onStop`, which is the mechanism: the queue advances when the
   * turn it waits on ends.
   */
  onSendNext?: () => void;
  disabled?: boolean;
  /** View-only sessions cannot edit drafts; pending sessions still can. */
  readOnly?: boolean;
  autofocus?: boolean;
  /**
   * Slash commands the harness advertises (ACP `available_commands_update`);
   * typing `/` opens a typeahead over them. `/` stays plain text while empty.
   */
  commands?: () => AgentCommandItem[];
  /**
   * Receives the composed markdown, including any `<m-document-mention>`
   * tags, and the attachments as they stood when Send was pressed. Either
   * may be empty, never both.
   */
  onSend: (markdown: string, attachments: InputAttachmentData[]) => void;
  onStop?: () => void;
  /**
   * Files attached so far, uploaded or still uploading. Owned by the parent
   * (an `InputAttachmentTracker`), which is what lets the composer clear
   * them after a send.
   */
  attachments?: InputAttachmentData[];
  /** Files the user dropped, pasted, or picked. Absent means no attaching. */
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment?: (attachment: InputAttachmentData) => void;
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

export function AgentInput(props: AgentInputProps) {
  const [markdown, setMarkdown] = createSignal('');
  const [isDraggedOver, setIsDraggedOver] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  const [layout, setLayout] = createSignal<HTMLDivElement>();
  const [content, setContent] = createSignal<HTMLDivElement>();
  const [height, setHeight] = createSignal<number>();
  // The surface is pinned to its content's height, so the measured element has
  // to enclose the attachment chips as well as the editor row — they sit inside
  // the surface, and a row-only measurement clips them.
  createResizeObserver(content, (_, element) => {
    setHeight(element.getBoundingClientRect().height);
  });
  useTouchOutsideToDismissKeyboard(() => containerRef);
  const dictation = createComposerDictation(() => editor.lexical);

  const attachments = () => props.attachments ?? [];
  const canAttach = () =>
    props.onAttachFiles !== undefined && !props.disabled && !props.readOnly;
  const hasPendingAttachments = () =>
    attachments().some((attachment) => attachment.pending);
  const attachFiles = (files: File[]) => {
    if (!canAttach() || files.length === 0) return;
    props.onAttachFiles?.(files);
  };

  // Sending while busy is allowed — the service queues prompts behind the
  // running turn. A file still uploading holds the send: its URL is not
  // known yet, and the agent gets exactly what the chips show.
  const canSend = () =>
    (markdown().trim().length > 0 || attachments().length > 0) &&
    !hasPendingAttachments() &&
    !props.disabled &&
    !props.readOnly &&
    !dictation.active();

  // The channel composer's chips, drop zone, and overlay read their state
  // from `Input.Root`'s context; this is that context, over this composer's
  // props. Only attaching and removing do anything - there is no channel
  // send or format ribbon behind these slots.
  const inputCommands: InputCommands = {
    send: async () => false,
    attachFiles: async (files) => attachFiles(files),
    toggleFormatRibbon: () => {},
    close: () => {},
    removeAttachment: (attachment) => {
      if (!props.readOnly) props.onRemoveAttachment?.(attachment);
    },
  };

  const send = () => {
    if (!canSend()) return;
    const content = markdown().trim();
    const attached = attachments();
    editor.controls.clear();
    props.onSend(content, attached);
  };

  // Deliberately not gated on `busy`. A speculated stop reads as done
  // everywhere else, so `busy` is already false while the runtime is still
  // winding the turn down - and that is exactly when a waiting message is
  // most worth advancing. What does gate it is `sendNextHeld`: a stop already
  // in flight, or a previous advance the log has not confirmed yet. Attached
  // files are something to send in their own right, so they hold it back too.
  const canSendNext = () =>
    !dictation.active() &&
    markdown().trim().length === 0 &&
    attachments().length === 0 &&
    props.hasQueuedMessages === true &&
    !props.sendNextHeld &&
    !props.disabled &&
    !props.readOnly &&
    props.onStop !== undefined;

  const sendNext = () => {
    if (!canSendNext()) return;
    // Stop bypasses the server queue: the fold shows it at once as a pending
    // Stopped line, and when the runtime ends the cancelled turn the server
    // dispatches the oldest waiting action, so the queue remains FIFO. How
    // soon that is depends on the runtime - a booting sandbox cannot be
    // interrupted until it is up.
    (props.onSendNext ?? props.onStop)?.();
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
    // Pasted files (and, on iOS, recovered clipboard images) become
    // attachments through the same door as a drop.
    .withFilePaste({
      onPasteFilesAndDirs: (files, directories) => {
        void handleFileFolderDrop(files, directories, (entries) =>
          attachFiles(entries.map((entry) => entry.file))
        );
      },
    })
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

  const { isCompact, hasMultilineContent } = createComposerLayout(
    editor.buildHandle().lexical,
    {
      container: layout,
      mode: () => (isTouchDevice() ? 'expanded' : 'auto'),
    }
  );

  onMount(() => {
    props.registerFocus?.(() => editor.controls.focus());
    onCleanup(() => props.registerFocus?.(undefined));
    props.registerQuoteInsert?.((text) => {
      if (props.readOnly) return;
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
  //
  // The tap's own default must not run afterwards: a mousedown on a target
  // with nothing focusable above it blurs the active element — the editor
  // just focused — and the keyboard drops again. Cancel pointerdown, and
  // mousedown too because a real iPhone still synthesises it after a
  // cancelled pointerdown (see `keepEditorFocus` in TouchSelectionToolbar).
  // Taps inside the contenteditable keep their defaults so the caret lands
  // under the finger.
  const focusEditor = (event: Event) => {
    if (props.readOnly) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button')) return;
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
      <div
        ref={containerRef}
        data-keep-keyboard
        class="flex flex-col gap-1.5"
        classList={{ 'opacity-50': props.readOnly }}
      >
        {/* Desktop: the model pill sits above the box, as it always has. */}
        <Show when={!isTouchDevice() && props.modelControl}>
          <div class="flex items-center px-0.5">{props.modelControl}</div>
        </Show>
        {/* h-auto beats Surface's size-full so the in-flow controls are not
            clipped over the editor (that was Auto sitting on the placeholder). */}
        <ComposerSurface
          class="relative h-auto transition-[height] duration-150 ease-out motion-reduce:transition-none"
          style={{
            height: height() === undefined ? undefined : `${height()}px`,
          }}
        >
          <Input.DropZone
            onDragStart={(valid) => canAttach() && setIsDraggedOver(valid)}
            onDragEnd={() => setIsDraggedOver(false)}
          >
            <Show when={canAttach()}>
              {/* Matches ComposerSurface's own radius so the overlay's rim
                  sits on the composer's edge, not inside it. */}
              <Input.DropOverlay
                class="rounded-[26.25px] touch:rounded-3xl"
                hint="Drop files here to send them to the agent"
              />
            </Show>
            <div
              ref={setContent}
              data-composer-content
              inert={dictation.active()}
              classList={{ invisible: dictation.active() }}
            >
              {/* Chips above the text, media and documents in their own rows,
                  exactly as the channel composer lays them out. */}
              <Input.Attachments kind="media" class="pb-0" />
              <Input.Attachments kind="document" class="pb-0" />
              {/* Desktop: one row, send right of the text. Touch: the text gets
                  the whole width and the controls drop to a footer row (model
                  left, send right) — the chat-tall / channel footer shape. */}
              <div
                ref={setLayout}
                data-composer-compact={isCompact()}
                class="group/composer flex items-end data-[composer-compact=false]:flex-col data-[composer-compact=false]:items-stretch gap-[3.75px] p-[7.5px] min-h-[48.75px] touch:min-h-0 touch:flex-col touch:items-stretch touch:gap-0 touch:p-0"
                onPointerDown={focusEditor}
                onMouseDown={focusEditor}
              >
                <div
                  id={AGENT_INPUT_TEXT_AREA_ID}
                  class="min-w-0 flex-1 group-data-[composer-compact=false]/composer:flex-none text-base text-ink not-touch:px-[9.375px] not-touch:py-[4.6875px] not-touch:leading-[24.375px] not-touch:min-h-[24.375px] not-touch:text-composer-ink touch:px-3 touch:py-2"
                  classList={{
                    // While empty only the placeholder renders; keep it to one clipped
                    // line so it doesn't wrap into the single-line height.
                    'overflow-hidden whitespace-nowrap':
                      markdown().trim().length === 0,
                    // Long drafts must not eat the mobile viewport above the dock.
                    'max-h-[calc(32*var(--dvh,1dvh))] overflow-y-auto':
                      hasMultilineContent() && isMobile(),
                  }}
                >
                  <ComposerEditor
                    config={editor}
                    disabled={props.readOnly}
                    placeholder={
                      props.placeholder ??
                      'Message the agent, @mention anything'
                    }
                    autofocus={
                      !props.readOnly &&
                      !isMobile() &&
                      !isTouchDevice() &&
                      props.autofocus
                    }
                  />
                </div>

                {/* In-flow — never absolute over the text. */}
                <div class="flex shrink-0 items-center gap-[3.75px] touch:h-8 touch:gap-2 touch:p-2 touch:mb-2">
                  <Show when={isTouchDevice() && props.modelControl}>
                    <div class="min-w-0">{props.modelControl}</div>
                  </Show>
                  <Show when={props.onAttachFiles}>
                    {/* The picker accepts whatever the drop zone does: an
                        agent's reason to attach a file is usually a source
                        file, and the static upload stores any type. */}
                    <Input.AttachFilesAction
                      accept={null}
                      disabled={props.disabled || props.readOnly}
                    />
                  </Show>
                  <div class="ml-auto flex shrink-0 items-center gap-[3.75px]">
                    <DictationButton
                      dictation={dictation}
                      disabled={props.disabled || props.readOnly}
                    />
                    <Show
                      when={canSendNext()}
                      fallback={
                        <Show
                          when={props.busy && props.onStop}
                          fallback={
                            <SendButton
                              appearance="composer"
                              tooltip="Send"
                              disabled={!canSend()}
                              onClick={send}
                            />
                          }
                        >
                          <Button
                            variant={isTouchDevice() ? 'ghost' : 'strong'}
                            size="icon-composer"
                            label="Stop"
                            disabled={props.disabled || props.readOnly}
                            onClick={() => props.onStop?.()}
                            class={
                              isTouchDevice()
                                ? 'rounded-full size-7.5 text-ink-extra-muted not-disabled:bg-ink/5 not-disabled:hover:bg-ink/10'
                                : undefined
                            }
                          >
                            <div class="size-3.5 not-touch:size-[13.125px] rounded-sm bg-current" />
                          </Button>
                        </Show>
                      }
                    >
                      <SendButton
                        appearance="composer"
                        aria-label="Send next queued message"
                        tooltip="Send next queued message"
                        shortcut="Enter"
                        onClick={sendNext}
                      >
                        <EnterIcon />
                      </SendButton>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </Input.DropZone>
          <DictationPanel dictation={dictation} />
        </ComposerSurface>
        <DictationFeedback dictation={dictation} />
      </div>
    </InputProvider>
  );
}
