import { useAnalytics } from '@app/component/analytics-context';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { useChatInputContext } from '@core/component/AI/context';
import type { Model, ToolSet } from '@core/component/AI/types';
import { Hotkey } from '@core/component/Hotkey';
import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { handleFileFolderDrop } from '@core/util/upload';
import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import PlusIcon from '@icon/regular/plus.svg';
import XIcon from '@icon/regular/x.svg';
import Stop from '@phosphor-icons/core/regular/stop.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { Panel } from '@ui';
import { cn } from '@ui/utils/classname';
import { createEffect, createSignal, Match, Show, Switch } from 'solid-js';
import { AttachmentList } from './Attachment';
import { ChatAttachMenu } from './ChatAttachMenu';
import { useAiDataConsentGate } from './useAiDataConsent';

export type ChatInputProps = {
  onSend: (args: ChatSendInput) => void;
  onStop?: () => void;
  onEscape?: (e: KeyboardEvent) => boolean;
  isPersistent?: boolean;
  showActiveTabs?: boolean;
  autoFocusOnMount?: boolean;
  chatId?: string;
  extraRightControls?: () => import('solid-js').JSX.Element;
};

export type ChatInputComponentProps = {
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
        variant="base"
        size="icon-md"
        onClick={() => setShowAttachMenu((prev) => !prev)}
      >
        {showAttachMenu() ? <XIcon /> : <PlusIcon />}
      </Button>
    </div>
  );

  const StopButton = () => (
    <Button
      variant="base"
      size="icon-sm"
      tooltip={<LabelAndHotKey label="Stop generating" shortcut="ctrl+c" />}
      onClick={() => props.onStop?.()}
    >
      <Stop />
    </Button>
  );

  const RightControls = () => (
    <Switch>
      <Match when={!isTouchDevice()}>
        <Show
          when={generating() && props.onStop}
          fallback={
            <div class="flex flex-row items-center gap-3 text-xs text-ink-disabled opacity-70 shrink-0">
              {props.extraRightControls?.()}
              <Tooltip tooltip="Enter to send" placement="top">
                <div class="flex items-center">
                  <div class="flex border border-edge-muted text-xxs rounded-xs items-center px-1 py-0.5">
                    <Hotkey shortcut="Enter" />
                  </div>
                </div>
              </Tooltip>
            </div>
          }
        >
          <div class="flex flex-row items-center gap-1 shrink-0">
            <StopButton />
          </div>
        </Show>
      </Match>
      <Match when={isTouchDevice()}>
        <div class="flex flex-row gap-1 items-center shrink-0">
          <Show when={!generating()}>
            <Button
              onClick={() => sendMessage({ modelOverride: 'claude-opus-4-6' })}
            >
              <div class="group hover:bg-accent transition ease-in-out size-6 p-0.5 border border-accent rounded-full flex items-center justify-center">
                <ArrowUp class="group-hover:text-input! group-hover:fill-input! text-accent-ink! fill-accent! size-4 transition ease-in-out" />
              </div>
            </Button>
          </Show>
          <Show when={generating()}>
            <StopButton />
          </Show>
        </div>
      </Match>
    </Switch>
  );

  return (
    <Panel depth={2}>
      <div id="chat-input" ref={containerRef} class="relative flex flex-col">
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
              'pr-[48px]': !isMultiline() && isTouchDevice(),
              'pr-[130px]': !isMultiline() && !isTouchDevice(),
              'pl-0 pr-0 pb-8': isMultiline(),
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

          <div
            class="absolute left-2"
            classList={{
              'top-1/2 -translate-y-1/2': !isMultiline(),
              'bottom-1.5 top-auto translate-y-0': isMultiline(),
            }}
          >
            <LeftButton />
          </div>

          <div
            class="absolute right-2"
            classList={{
              'top-1/2 -translate-y-1/2': !isMultiline(),
              'bottom-1.5 top-auto translate-y-0': isMultiline(),
            }}
          >
            <RightControls />
          </div>
        </div>
        <ConsentDialog />
      </div>
    </Panel>
  );
}
