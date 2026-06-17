import { useAnalytics } from '@app/component/analytics-context';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ModelSelector } from '@core/component/AI/component/input/ModelSelector';
import { useChatInputContext } from '@core/component/AI/context';
import type { Model, ToolSet } from '@core/component/AI/types';
import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { handleFileFolderDrop } from '@core/util/upload';
import PaperclipIcon from '@phosphor/paperclip.svg';
import { useModelsQuery } from '@queries/chat';
import { queryReadyGate } from '@queries/gate';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn, Surface, SendButton as UiSendButton } from '@ui';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { AttachmentList } from './Attachment';
import { ChatAttachMenu } from './ChatAttachMenu';
import { useAiDataConsentGate } from './useAiDataConsent';

type ChatInputProps = {
  onSend: (args: ChatSendInput) => void;
  onStop?: () => void;
  onEscape?: (e: KeyboardEvent) => boolean;
  isPersistent?: boolean;
  showActiveTabs?: boolean;
  autoFocusOnMount?: boolean;
  chatId?: string;
};

type ChatInputComponentProps = {
  variant?: 'default' | 'tall';
  editor: EditorConfigBuilder;
  initialValue?: string;
  onChange?: (markdown: string) => void;
} & ChatInputProps;

export function ChatInput(props: ChatInputComponentProps) {
  const analytics = useAnalytics();

  const input = useChatInputContext();
  const uploadQueue = input.uploadQueue;
  const attachments = input.attachments;
  const model = input.model;
  const generating = input.isGenerating;
  const { showPaywall } = usePaywallState();

  // Which models this user may use (free → Haiku; professional → all).
  // Gate on the query so reading `.data` doesn't trip Suspense while loading;
  // an empty list until ready is fine (the effect below no-ops on `[]`).
  const modelsQuery = useModelsQuery();
  const modelOptions = createMemo(() => {
    if (!queryReadyGate(modelsQuery)) return [];
    return modelsQuery.data.models.map((m) => ({
      id: m.id as Model,
      available: m.available,
    }));
  });

  // If the selected model isn't available to this user, fall back to the
  // first available one so we never send a model that would 403.
  createEffect(() => {
    const options = modelOptions();
    if (options.length === 0) return;
    if (options.some((o) => o.id === model() && o.available)) return;
    const firstAvailable = options.find((o) => o.available);
    if (firstAvailable) input.setModel(firstAvailable.id);
  });

  let containerRef!: HTMLDivElement;
  useTouchOutsideToDismissKeyboard(() => containerRef);

  // The model selector lives inside the input, directly left of the send
  // button, and collapses to just the provider icon when the line is too tight
  // (mobile, a small split). Rather than guess a viewport breakpoint, we test
  // actual fit: an invisible, always-expanded probe of the control row is
  // measured against the available line width. The probe keeps full width
  // whatever the visible selector shows, so collapsing can't change the
  // measurement and oscillate, and it's content-driven (reacts to real
  // text/font/zoom). Both are ResizeObserver-backed, so it stays live on resize.
  const [lineEl, setLineEl] = createSignal<HTMLElement>();
  const [probeEl, setProbeEl] = createSignal<HTMLElement>();
  const lineSize = createElementSize(lineEl);
  const probeSize = createElementSize(probeEl);
  const compactSelector = () =>
    !isTallVariant() &&
    probeSize.width != null &&
    lineSize.width != null &&
    probeSize.width > lineSize.width;
  // Comfortable typing room to keep for the editor when deciding the selector
  // fits. The selector collapses while the body still has at least this much
  // room, so the body never gets squeezed into wrapping to make space for it.
  const MIN_EDITOR_WIDTH = 180;

  // Reserve space on the single-line layout so flowing text never slides under
  // the right-hand controls (whose width changes with the selector's state).
  const [rightControlsEl, setRightControlsEl] = createSignal<HTMLElement>();
  const rightControlsSize = createElementSize(rightControlsEl);
  const rightControlsInset = () => (rightControlsSize.width ?? 44) + 10;

  const toolsetSignal = createSignal<ToolSet>({ type: 'all' });
  const { hasConsent, requestConsent, ConsentDialog } = useAiDataConsentGate();

  const [showAttachMenu, setShowAttachMenu] = createSignal(false);
  const [attachMenuAnchorRef, setAttachMenuAnchorRef] =
    createSignal<HTMLDivElement>();
  const [markdownText, setMarkdownText] = createSignal('');
  const [isFocused, setIsFocused] = createSignal(false);

  createEffect(() => {
    const uploaded = uploadQueue.popComplete();
    uploaded
      .filter((upload) => upload.type === 'ok')
      .forEach((upload) => {
        analytics.track('ai_attachment_add');
        attachments.addAttachment(upload.attachment);
      });
  });

  const isEmptyInput = () => markdownText().trim().length === 0;
  const hasUploadingAttachments = () => uploadQueue.uploading().length > 0;
  const canSendMessage = () =>
    !isEmptyInput() && !generating() && !hasUploadingAttachments();

  const LINE_HEIGHT_THRESHOLD = 40;
  let mdRef: undefined | HTMLDivElement;
  const isMultiline = () => {
    // Access markdownText to create reactive dependency
    const text = markdownText();
    if (text.trim().length === 0) return false;
    if (!mdRef) return false;
    return mdRef.scrollHeight > LINE_HEIGHT_THRESHOLD;
  };

  const sendMessage = createCallback(
    async (opts?: { modelOverride?: Model; metaKey?: boolean }) => {
      if (!canSendMessage()) return;

      if (isNativeMobilePlatform() && !hasConsent()) {
        requestConsent(() => sendMessage(opts));
        return;
      }

      const sendInput: ChatSendInput = {
        content: markdownText(),
        model: opts?.modelOverride ?? model(),
        attachments: attachments.attached(),
        toolset: toolsetSignal[0](),
        metaKey: opts?.metaKey,
      };
      props.editor.controls.clear();
      attachments.setAttached([]);
      props.onSend(sendInput);
    }
  );

  props.editor
    .withFilePaste({
      onPasteFilesAndDirs: (files, directories) => {
        if (directories.length > 0) {
          toast.failure('Folder upload not supported here');
          return;
        }
        handleFileFolderDrop(files, directories, (entries) => {
          uploadQueue.upload(entries.map((e) => e.file));
        });
      },
    })
    .onEnter((e) => {
      if (canSendMessage()) {
        sendMessage({ metaKey: e?.metaKey });
      }
      return true;
    })
    .onEscape((e) => props.onEscape?.(e) ?? false)
    .onChange((md) => {
      setMarkdownText(md);
      props.onChange?.(md);
    });

  const hasAttachments = () =>
    attachments.attached().length > 0 || uploadQueue.uploading().length > 0;

  const LeftButton = () => (
    <Button
      ref={setAttachMenuAnchorRef}
      variant="ghost"
      size="icon-sm"
      class="text-ink"
      onClick={() => setShowAttachMenu((prev) => !prev)}
    >
      <PaperclipIcon />
    </Button>
  );

  const StopButton = () => (
    <Button
      variant="ghost"
      size="icon-sm"
      label="Stop generating"
      hotkey={TOKENS.chat.stop}
      onClick={() => props.onStop?.()}
      class={cn(
        'rounded-[11px] size-7.5 text-ink-extra-muted [&_svg]:stroke-[4px]',
        'not-disabled:bg-ink/5 not-disabled:hover:bg-ink/10',
        'data-disabled:opacity-100 data-disabled:text-ink-extra-muted data-disabled:bg-ink-muted/5'
      )}
    >
      <div class="size-3.5 rounded-sm bg-current" />
    </Button>
  );

  // On mobile the send button is hidden while the input is empty. Collapse it
  // (display:none) rather than just fading it, so it doesn't reserve width and
  // offset the model selector from the right edge.
  const sendHidden = () => isMobile() && isEmptyInput();
  const SendButton = () => (
    <UiSendButton
      tooltip={'Ask AI'}
      shortcut="enter"
      tooltipPlacement="top"
      disabled={!canSendMessage()}
      class={sendHidden() ? 'hidden' : undefined}
      onClick={() => sendMessage()}
    />
  );

  const RightControls = () => (
    <div ref={setRightControlsEl} class="flex shrink-0 items-center gap-1">
      <ModelSelector
        selectedModel={model()}
        models={modelOptions()}
        onSelect={(m) => input.setModel(m)}
        onLocked={() => showPaywall(PaywallKey.MODEL_LIMIT)}
        compact={compactSelector()}
      />
      <Show when={generating() && props.onStop} fallback={<SendButton />}>
        <StopButton />
      </Show>
    </div>
  );

  const Attachments = () => (
    <Show when={hasAttachments()}>
      <div class={cn('px-2 pt-2 w-full', isTallVariant() && 'px-0')}>
        <AttachmentList
          attached={attachments.attached}
          removeAttachment={(id) => {
            attachments.removeAttachment(id);
          }}
          uploading={() =>
            uploadQueue.uploading().map((uploading) => uploading.preview)
          }
        />
      </div>
    </Show>
  );

  const isTallVariant = createMemo(() => props.variant === 'tall');

  return (
    <div class="relative">
      <Surface active={isFocused()} class="rounded-xl" depth={2} solid>
        <div
          onFocusOut={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && containerRef.contains(next)) return;
            setIsFocused(false);
          }}
          onFocusIn={() => setIsFocused(true)}
          class="relative flex flex-col"
          ref={containerRef}
          id="chat-input"
        >
          <Show when={!isTallVariant()}>
            <Attachments />
          </Show>

          <Show when={showAttachMenu()}>
            <ChatAttachMenu
              anchorRef={attachMenuAnchorRef()!}
              close={() => setShowAttachMenu(false)}
              containerRef={containerRef}
              open={showAttachMenu()}
              onAttach={(attachment) => {
                analytics.track('ai_attachment_add');
                attachments.addAttachment(attachment);
              }}
            />
          </Show>

          <div
            ref={setLineEl}
            class={cn('relative px-2 py-1.5', {
              'flex flex-col px-3 py-2': isTallVariant(),
            })}
          >
            {/* Invisible reference of the fully-expanded control row laid out
                inline (paperclip + min editor room + full selector + send). Its
                measured width is the space the expanded selector needs; when
                that exceeds the line, the visible selector collapses. */}
            <Show when={!isTallVariant()}>
              <div
                ref={setProbeEl}
                aria-hidden="true"
                inert
                class="pointer-events-none invisible absolute flex w-max items-center gap-1"
              >
                <div class="size-7.5 shrink-0" />
                <div
                  class="shrink-0"
                  style={{ width: `${MIN_EDITOR_WIDTH}px` }}
                />
                <ModelSelector
                  selectedModel={model()}
                  models={modelOptions()}
                  onSelect={() => {}}
                />
                <div class="size-7.5 shrink-0" />
              </div>
            </Show>
            <div
              id="chat-input-text-area"
              class={cn('text-sm sm:text-sm text-ink')}
              classList={{
                'pl-8': !isMultiline() && !isTallVariant(),
                'px-0 pb-8': isMultiline() && !isTallVariant(),
                // While empty, the only thing rendered is the placeholder.
                // `white-space` inherits, so this keeps it on one line (clipped)
                // instead of wrapping into the single-line height. Typing clears
                // it, restoring normal wrapping / grow-to-multiline.
                'overflow-hidden whitespace-nowrap': isEmptyInput(),
              }}
              style={
                !isMultiline() && !isTallVariant()
                  ? { 'padding-right': `${rightControlsInset()}px` }
                  : undefined
              }
              ref={mdRef}
            >
              <MarkdownShell
                config={props.editor}
                placeholder="Ask AI, @mention anything"
                initialValue={props.initialValue}
                autofocus={
                  !isMobile() &&
                  !isTouchDevice() &&
                  props.autoFocusOnMount !== false
                }
              />
              <Show when={isTallVariant()}>
                <div class="h-4" />
              </Show>
              <Show when={isTallVariant()}>
                <Attachments />
              </Show>
            </div>

            <div
              class={cn('contents', {
                'flex justify-between items-center': isTallVariant(),
              })}
            >
              <div class={cn(!isTallVariant() && 'absolute left-2 bottom-1.5')}>
                <LeftButton />
              </div>

              <div
                class={cn(!isTallVariant() && 'absolute right-1.5 bottom-1.5')}
              >
                <RightControls />
              </div>
            </div>
          </div>
        </div>
        <ConsentDialog />
      </Surface>
    </div>
  );
}
