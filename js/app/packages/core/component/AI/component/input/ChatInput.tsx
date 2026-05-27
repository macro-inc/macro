import { useAnalytics } from '@app/component/analytics-context';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { useChatInputContext } from '@core/component/AI/context';
import type { Model, ToolSet } from '@core/component/AI/types';
import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { handleFileFolderDrop } from '@core/util/upload';
import PaperclipIcon from '@phosphor/paperclip.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn, Surface, SendButton as UiSendButton } from '@ui';
import { createEffect, createSignal, Show } from 'solid-js';
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

  let containerRef!: HTMLDivElement;
  useTouchOutsideToDismissKeyboard(() => containerRef);
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
    <div ref={setAttachMenuAnchorRef} class="shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-ink"
        onClick={() => setShowAttachMenu((prev) => !prev)}
      >
        <PaperclipIcon />
      </Button>
    </div>
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

  const SendButton = () => (
    <UiSendButton
      tooltip={'Ask Ai'}
      shortcut="enter"
      tooltipPlacement="top"
      disabled={!canSendMessage()}
      hidden={isMobile() && isEmptyInput()}
      onClick={() =>
        sendMessage(isTouchDevice() ? { modelOverride: 'smart' } : undefined)
      }
    />
  );

  const RightControls = () => (
    <div class="shrink-0">
      <Show when={generating() && props.onStop} fallback={<SendButton />}>
        <StopButton />
      </Show>
    </div>
  );

  return (
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
        <Show when={hasAttachments()}>
          <div class="px-2 pt-2 w-full">
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

        <div class="relative px-2 py-1.5">
          <div
            id="chat-input-text-area"
            class={cn('text-sm sm:text-sm text-ink')}
            classList={{
              'pl-8': !isMultiline(),
              'pr-12': !isMultiline() && isTouchDevice(),
              'pr-32.5': !isMultiline() && !isTouchDevice(),
              'px-0  pb-8': isMultiline(),
            }}
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
          </div>

          <div class="absolute left-2 bottom-1.5">
            <LeftButton />
          </div>

          <div class="absolute right-1.5 bottom-1.5">
            <RightControls />
          </div>
        </div>
        <ConsentDialog />
      </div>
    </Surface>
  );
}
