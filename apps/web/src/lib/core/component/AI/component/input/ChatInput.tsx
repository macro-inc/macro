import {
  DictationButton,
  DictationFeedback,
  DictationPanel,
} from '@app/features/dictation/components/dictation-controls';
import { createComposerDictation } from '@app/features/dictation/composer-dictation';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useHasPaidAccess } from '@core/auth/license';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ModelSelector } from '@core/component/AI/component/input/ModelSelector';
import {
  defaultModelForPlan,
  Model,
  modelsForPlan,
  SUPPORTED_ATTACHMENT_EXTENSIONS,
} from '@core/component/AI/constant';
import { useChatInputContext } from '@core/component/AI/context';
import type { ToolSet } from '@core/component/AI/types';
import { isImageAttachment } from '@core/component/AI/util/attachment';
import { insertChatAttachmentMention } from '@core/component/AI/util/chatAttachmentMention';
import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import { createComposerLayout } from '@core/component/LexicalMarkdown/utils/create-composer-layout';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { handleFileFolderDrop } from '@core/util/upload';
import PaperclipIcon from '@phosphor/paperclip.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createCallback } from '@solid-primitives/rootless';
import { Button, ComposerSurface, cn, SendButton as UiSendButton } from '@ui';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { AttachmentList } from './Attachment';
import { useAiDataConsentGate } from './useAiDataConsent';

/**
 * Id of the chat input's text-area wrapper. Exposed so callers (e.g. the
 * mobile Create menu) can arm focus on the contenteditable before it mounts.
 */
export const CHAT_INPUT_TEXT_AREA_ID = 'chat-input-text-area';

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
  class?: string;
  placeholder?: string;
  /** Keep an unfocused mobile accessory to one line without unmounting its editor. */
  collapseOnBlur?: boolean;
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
  const hasPaidAccess = useHasPaidAccess();

  // Every model is shown to every user; availability is per-plan. Free users
  // see the premium models locked (dimmed + lock icon), and clicking one opens
  // the paywall via `onLocked` rather than sending and being rejected by the
  // backend. Listing only the free model would mean free users never see the
  // upsell at all.
  const modelOptions = createMemo(() => {
    const allowed = modelsForPlan(hasPaidAccess());
    return Object.values(Model).map((id) => ({
      id,
      available: allowed.includes(id),
    }));
  });

  // Keep the selected model valid for the current plan: if it isn't a known id
  // (e.g. a stale persisted value) or isn't available to this user (e.g. a free
  // user defaulted to Opus), fall back to the plan default so we never send
  // something unroutable or something the backend rejects.
  createEffect(() => {
    const options = modelOptions();
    if (options.some((o) => o.id === model() && o.available)) return;
    input.setModel(defaultModelForPlan(hasPaidAccess()));
  });

  let containerRef!: HTMLDivElement;
  let fileInputRef: HTMLInputElement | undefined;
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
    isTouchDevice() ||
    (!isTallVariant() &&
      probeSize.width != null &&
      lineSize.width != null &&
      probeSize.width > lineSize.width);
  // Comfortable typing room to keep for the editor when deciding the selector
  // fits. The selector collapses while the body still has at least this much
  // room, so the body never gets squeezed into wrapping to make space for it.
  const MIN_EDITOR_WIDTH = 180;

  // Reserve space on the single-line layout so flowing text never slides under
  // the right-hand controls (whose width changes with the selector's state).
  const [rightControlsEl, setRightControlsEl] = createSignal<HTMLElement>();
  const rightControlsSize = createElementSize(rightControlsEl);
  const rightControlsInset = () =>
    isTouchDevice()
      ? (rightControlsSize.width ?? 44) + 10
      : (rightControlsSize.width ?? 41.25) + 9.375;

  const toolsetSignal = createSignal<ToolSet>({ type: 'all' });
  const { hasConsent, requestConsent, ConsentDialog } = useAiDataConsentGate();

  const [markdownText, setMarkdownText] = createSignal('');
  const [isFocused, setIsFocused] = createSignal(false);
  const dictation = createComposerDictation(() => props.editor.lexical);

  createEffect(() => {
    const uploaded = uploadQueue.popComplete();
    uploaded
      .filter((upload) => upload.type === 'ok')
      .forEach((upload) => {
        analytics.track('ai_attachment_add');
        attachments.addAttachment(upload.attachment);
        const metadata = upload.preview.metadata;
        if (
          upload.attachment.entity_type === 'document' &&
          metadata?.type === 'document'
        ) {
          insertChatAttachmentMention(props.editor.controls.getLexical(), {
            documentId: upload.attachment.entity_id,
            documentName: metadata.document_name,
            blockName: fileTypeToBlockName(metadata.document_type, true),
          });
        }
      });
  });

  const isEmptyInput = () => markdownText().trim().length === 0;
  const hasAttachedFiles = () => attachments.attached().length > 0;
  const hasUploadingAttachments = () => uploadQueue.uploading().length > 0;
  const canSendMessage = () =>
    !dictation.active() &&
    (!isEmptyInput() || hasAttachedFiles()) &&
    !generating() &&
    !hasUploadingAttachments();

  let mdRef: undefined | HTMLDivElement;

  const isTallVariant = createMemo(
    () =>
      props.variant === 'tall' ||
      (isTouchDevice() && props.variant !== 'default')
  );
  const isCollapsed = () =>
    !dictation.active() &&
    props.collapseOnBlur &&
    isTouchDevice() &&
    !isTallVariant() &&
    !isFocused() &&
    !isEmptyInput();

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
    .onEscape((e) => {
      if (dictation.active()) {
        dictation.cancel();
        return true;
      }
      return props.onEscape?.(e) ?? false;
    })
    .onChange((md) => {
      setMarkdownText(md);
      props.onChange?.(md);
    });

  const composerLayout = createComposerLayout(
    props.editor.buildHandle().lexical,
    {
      container: lineEl,
      mode: () => {
        if (isTallVariant()) return 'expanded';
        return isCollapsed() ? 'collapsed' : 'auto';
      },
    }
  );
  const isMultiline = () =>
    !isCollapsed() && composerLayout.hasMultilineContent();

  const hasAttachments = () =>
    attachments.attached().some(isImageAttachment) ||
    uploadQueue.uploading().length > 0;

  const LeftButton = () => (
    <Button
      variant="ghost"
      size="icon-composer"
      class="rounded-full text-ink not-touch:text-composer-ink touch:size-6"
      label="Attach files"
      aria-label="Attach files"
      onClick={() => {
        // Open synchronously from the tap so the native picker retains user activation.
        fileInputRef?.click();
      }}
    >
      <PaperclipIcon />
    </Button>
  );

  const StopButton = () => (
    <Button
      variant={isTouchDevice() ? 'ghost' : 'strong'}
      size="icon-composer"
      label="Stop generating"
      hotkey={TOKENS.chat.stop}
      onClick={() => props.onStop?.()}
      class={cn(
        'rounded-full touch:size-7.5 [&_svg]:stroke-[4px]',
        isTouchDevice() &&
          'text-ink-extra-muted not-disabled:bg-ink/5 not-disabled:hover:bg-ink/10',
        'data-disabled:opacity-100 data-disabled:text-ink-extra-muted data-disabled:bg-ink-muted/5'
      )}
    >
      <div class="size-3.5 not-touch:size-[13.125px] rounded-sm bg-current" />
    </Button>
  );

  const SendButton = () => (
    <UiSendButton
      appearance="composer"
      tooltip={'Ask AI'}
      shortcut="enter"
      tooltipPlacement="top"
      disabled={!canSendMessage()}
      class="touch:rounded-full"
      onClick={() => sendMessage()}
    />
  );

  const RightControls = () => (
    <div
      ref={setRightControlsEl}
      class="flex shrink-0 items-center gap-1 not-touch:gap-[3.75px]"
    >
      <ModelSelector
        selectedModel={model()}
        models={modelOptions()}
        onSelect={(m) => input.setModel(m)}
        onLocked={() => showPaywall(PaywallKey.O1_LIMIT)}
        compact={compactSelector()}
      />
      <DictationButton dictation={dictation} />
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

  const isCompactMobile = () => isTouchDevice() && composerLayout.isCompact();

  return (
    <div class="relative">
      <input
        ref={fileInputRef}
        type="file"
        class="hidden"
        multiple
        accept={SUPPORTED_ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(
          ','
        )}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []).filter(
            (file) =>
              SUPPORTED_ATTACHMENT_EXTENSIONS.includes(
                file.name.split('.').pop()?.toLowerCase() ?? ''
              )
          );
          event.currentTarget.value = '';
          if (files.length > 0) uploadQueue.upload(files);
        }}
      />
      <ComposerSurface
        class={cn(
          'relative h-auto',
          composerLayout.isCompact() &&
            !hasAttachments() &&
            'touch:rounded-full',
          props.class
        )}
      >
        <div
          inert={dictation.active()}
          classList={{ invisible: dictation.active() }}
          onFocusOut={(e) => {
            if (dictation.active()) return;
            const next = e.relatedTarget as Node | null;
            if (next && containerRef.contains(next)) return;
            setIsFocused(false);
            if (isCollapsed() && mdRef) mdRef.scrollTop = 0;
          }}
          onFocusIn={() => setIsFocused(true)}
          class="relative flex flex-col"
          ref={containerRef}
          id="chat-input"
        >
          <Show when={!isTallVariant()}>
            <Attachments />
          </Show>

          <div
            data-chat-input-layout=""
            data-composer-compact={
              composerLayout.isCompact() ? 'true' : 'false'
            }
            ref={setLineEl}
            class={cn(
              'group/composer relative px-[7.5px] touch:px-2 touch:min-h-12.5 touch:py-[9px]',
              'data-[composer-compact=true]:px-[7.5px] data-[composer-compact=true]:touch:px-2',
              {
                'flex flex-col pt-[11.25px] pb-[7.5px] touch:p-0':
                  isTallVariant(),
                'not-touch:min-h-[48.75px] py-[12.1875px]': !isTallVariant(),
                'touch:h-(--mobile-chrome-button-size) touch:min-h-0 touch:py-0 touch:flex touch:items-center':
                  isCompactMobile(),
              }
            )}
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
                class="pointer-events-none invisible absolute flex w-max items-center gap-1 not-touch:gap-[3.75px]"
              >
                <div class="size-7 not-touch:size-[33.75px] shrink-0" />
                <div
                  class="shrink-0"
                  style={{ width: `${MIN_EDITOR_WIDTH}px` }}
                />
                <ModelSelector
                  selectedModel={model()}
                  models={modelOptions()}
                  onSelect={() => {}}
                />
                <div class="size-7 not-touch:size-[33.75px] shrink-0" />
                <div class="size-7 not-touch:size-[33.75px] shrink-0" />
              </div>
            </Show>
            <div
              id={CHAT_INPUT_TEXT_AREA_ID}
              class={cn(
                'text-base text-ink touch:px-3 touch:py-2 not-touch:leading-[24.375px] not-touch:text-composer-ink',
                'group-data-[composer-compact=true]/composer:touch:w-full group-data-[composer-compact=true]/composer:touch:py-0',
                'group-data-[composer-compact=false]/composer:not-touch:px-[9.375px]',
                'group-data-[composer-compact=true]/composer:pl-[41.25px] group-data-[composer-compact=true]/composer:touch:pl-10 group-data-[composer-compact=true]/composer:pr-(--composer-right-inset)'
              )}
              classList={{
                'pb-[37.5px] touch:pb-10': isMultiline() && !isTallVariant(),
                'max-h-[calc(32*var(--dvh,1dvh))] overflow-y-auto':
                  isMobile() && isMultiline(),
                // While empty, the only thing rendered is the placeholder.
                // `white-space` inherits, so this keeps it on one line (clipped)
                // instead of wrapping into the single-line height. Typing clears
                // it, restoring normal wrapping / grow-to-multiline.
                'overflow-hidden whitespace-nowrap': isEmptyInput(),
                // Clip the scroll container itself so scrollHeight still reports
                // the full draft when focus restores the expanded layout.
                'max-h-5 overflow-hidden [&_[contenteditable]>:first-child]:mt-0!':
                  isCollapsed(),
              }}
              style={{ '--composer-right-inset': `${rightControlsInset()}px` }}
              ref={mdRef}
            >
              <ComposerEditor
                class={isCompactMobile() ? 'min-h-5' : undefined}
                config={props.editor}
                placeholder={
                  props.placeholder ??
                  (isTouchDevice() ? 'Ask AI…' : 'Ask AI, @mention anything')
                }
                initialValue={props.initialValue}
                autofocus={
                  !isMobile() &&
                  !isTouchDevice() &&
                  props.autoFocusOnMount !== false
                }
              />
              <Show when={isTallVariant()}>
                <div class="h-[15px] touch:hidden" />
              </Show>
              <Show when={isTallVariant()}>
                <Attachments />
              </Show>
            </div>

            <div
              class={cn('contents', {
                'flex justify-between items-center touch:h-8 touch:gap-2 touch:p-2 touch:mb-2':
                  isTallVariant(),
              })}
            >
              <div
                class={cn(
                  !isTallVariant() &&
                    'absolute left-[7.5px] bottom-[7.5px] touch:left-2 touch:bottom-[7px]',
                  isCompactMobile() &&
                    'touch:top-1/2 touch:bottom-auto touch:-translate-y-1/2'
                )}
              >
                <LeftButton />
              </div>

              <div
                class={cn(
                  !isTallVariant() &&
                    'absolute right-[7.5px] bottom-[7.5px] touch:right-2 touch:bottom-[7px]',
                  isCompactMobile() &&
                    'touch:right-[5px] touch:top-1/2 touch:bottom-auto touch:-translate-y-1/2'
                )}
              >
                <RightControls />
              </div>
            </div>
          </div>
        </div>
        <DictationPanel dictation={dictation} />
        <ConsentDialog />
      </ComposerSurface>
      <DictationFeedback dictation={dictation} />
    </div>
  );
}
