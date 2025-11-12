import { withAnalytics } from '@coparse/analytics';
import { useBuildChatSendRequest } from '@core/component/AI/component/input/buildRequest';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import {
  useAttachments,
  useChatAttachableHistory,
} from '@core/component/AI/signal/attachment';
import type {
  Attachment,
  Attachments,
  CreateAndSend,
  Model,
  Send,
  ToolSet,
  UploadQueue,
} from '@core/component/AI/types';
import { useUploadAttachment } from '@core/component/AI/util/uploadToChat';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { IconButton } from '@core/component/IconButton';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import PlusIcon from '@icon/regular/plus.svg';
import XIcon from '@icon/regular/x.svg';
import { createCallback } from '@solid-primitives/rootless';
import type { LexicalEditor } from 'lexical';
import type { Accessor, Component, Setter } from 'solid-js';
import { createEffect, createSignal, Match, Show, Switch } from 'solid-js';
import { ActiveTabAttachment } from './ActiveTabAttachment';
import { AttachmentList } from './Attachment';
import { ChatAttachMenu } from './ChatAttachMenu';
import { SendMessageButton, StopButton } from './SendMessageButton';
import { type Source, ToolsetSelector } from './ToolsetSelector';
import {
  type UseChatMarkdown,
  useChatMarkdownArea,
} from './useChatMarkdownArea';

const { track, TrackingEvents } = withAnalytics();

export type ChatInputProps = {
  onSend: (args: CreateAndSend | Send) => void;
  onStop?: () => void;
  isPersistent?: boolean;
  showActiveTabs?: boolean;
  captureEditor?: (editor: LexicalEditor) => void;
};

type ChatInputInternalProps = {
  uploadQueue: UploadQueue;
  isGenerating: Accessor<boolean>;
  attachments: Attachments;
  chatId: Accessor<string | undefined>;
  model: Accessor<Model>;
  setModel: Setter<Model>;
  markdown: UseChatMarkdown;
} & ChatInputProps;

export type ChatInput = {
  ChatInput: Component<ChatInputProps>;
  uploadQueue: UploadQueue;
  setChatId: (chatId: string | undefined) => void;
  chatId: Accessor<string | undefined>;
  model: Accessor<Model>;
  setModel: (model?: Model) => void;
  attachments: Attachments;
  isGenerating: Accessor<boolean>;
  setIsGenerating: (generating: boolean) => void;
  chatMarkdownArea: UseChatMarkdown;
};

export function useChatInput(
  args: {
    chatId?: string;
    model?: Model;
    isGenerating?: boolean;
    initialAttachments?: Attachment[];
    initialValue?: string;
  } = {}
): ChatInput {
  const [chatId, setChatId] = createSignal<string | undefined>(args.chatId);
  const [model, setModel] = createSignal<Model>(args.model ?? DEFAULT_MODEL);
  const [isGenerating, setIsGenerating] = createSignal<boolean>(
    args.isGenerating ?? false
  );
  const uploadQueue = useUploadAttachment();
  const attachments = useAttachments(args.initialAttachments);

  const chatMarkdownArea = useChatMarkdownArea({
    initialValue: args.initialValue,
    addAttachment: (a) => {
      attachments.addAttachment(a);
    },
  });

  const ChatInputComponent = (innerProps: ChatInputProps) => (
    <ChatInput
      {...innerProps}
      chatId={chatId}
      uploadQueue={uploadQueue}
      model={model}
      setModel={setModel}
      isGenerating={isGenerating}
      attachments={attachments}
      markdown={chatMarkdownArea}
    />
  );

  const setModelWithDefault = (model?: Model) => {
    if (model === undefined) {
      setModel(DEFAULT_MODEL);
    } else {
      setModel(model);
    }
  };

  return {
    setChatId,
    chatId,
    model,
    setModel: setModelWithDefault,
    attachments,
    isGenerating,
    setIsGenerating,
    uploadQueue,
    ChatInput: ChatInputComponent,
    chatMarkdownArea,
  };
}

function ChatInput(props: ChatInputInternalProps) {
  console.log('CHAT INPUT', props);
  let containerRef!: HTMLDivElement;
  const generating = props.isGenerating ?? (() => false);
  const toolsetSignal = createSignal<ToolSet>({ type: 'all' });

  const [source, setSource] = createSignal<Source>('everything');
  const [showAttachMenu, setShowAttachMenu] = createSignal(false);
  const [attachMenuAnchorRef, setAttachMenuAnchorRef] =
    createSignal<HTMLDivElement>();

  createEffect(() => {
    const uploaded = props.uploadQueue.popComplete();
    uploaded
      .filter((upload) => upload.type === 'ok')
      .forEach((upload) => {
        track(TrackingEvents.CHAT.ATTACHMENT.ADD);
        props.attachments.addAttachment(upload.attachment);
      });
  });

  const isEmptyInput = () => props.markdown.markdownText().trim().length === 0;
  const hasUploadingAttachments = () =>
    props.uploadQueue.uploading().length > 0;
  const canSendMessage = () =>
    !isEmptyInput() && !generating() && !hasUploadingAttachments();

  const buildChatSendRequest = useBuildChatSendRequest();
  const sendMessage = createCallback(async () => {
    if (!canSendMessage()) return;

    const request = await buildChatSendRequest({
      chatId: props.chatId(),
      userRequest: props.markdown.markdownText(),
      isPersistent: props.isPersistent,
      attachments: props.attachments.attached(),
      model: props.model(),
      toolset: toolsetSignal[0](),
      source: source(),
    });
    props.markdown.clear();
    props.onSend(request);
  });

  function handleEnter(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Always prevent default for Enter (unless Shift is held)
      e.preventDefault();

      // Only send if we can send, otherwise no-op
      if (canSendMessage()) {
        sendMessage();
      }

      return true;
    } else {
      return false;
    }
  }

  const availableAttachments = useChatAttachableHistory();

  return (
    <div
      id="chat-input"
      ref={containerRef}
      class="relative flex-1 flex flex-col items-center sm:self-center bg-input border-t border-l border-r sm:border border-edge min-h-26 max-h-50 justify-between focus-within:bracket-offset-2"
    >
      <div class="relative w-full z-0 pt-2 px-4 flex-1 overflow-hidden">
        <div
          id="chat-input-text-area"
          class="rounded-md w-full h-full text-base sm:text-sm text-ink"
        >
          <props.markdown.MarkdownArea
            onEnter={handleEnter}
            placeholder="Ask AI -  @mention anything"
            history={availableAttachments}
            dontFocusOnMount={isMobileWidth()}
            onPasteFile={props.uploadQueue.upload}
            captureEditor={props.captureEditor}
          />
        </div>
      </div>
      <div class="w-full">
        <div class="px-2 w-full min-h-0">
          <AttachmentList
            attached={props.attachments.attached}
            removeAttachment={(id) => {
              track(TrackingEvents.CHAT.ATTACHMENT.REMOVE);
              props.attachments.removeAttachment(id);
            }}
            uploading={() =>
              props.uploadQueue
                .uploading()
                .map((uploading) => uploading.preview)
            }
          />
        </div>
        <div class="flex justify-between w-full px-2">
          <Show when={showAttachMenu()}>
            <ChatAttachMenu
              anchorRef={attachMenuAnchorRef()!}
              close={() => setShowAttachMenu(false)}
              containerRef={containerRef}
              open={showAttachMenu()}
              onAttach={(attachment) => {
                track(TrackingEvents.CHAT.ATTACHMENT.ADD);
                props.attachments.addAttachment(attachment);
              }}
              uploadQueue={props.uploadQueue}
            />
          </Show>
          <div class="flex items-center">
            <IconButton
              icon={showAttachMenu() ? XIcon : PlusIcon}
              theme="base"
              size="sm"
              ref={setAttachMenuAnchorRef}
              onClick={() => setShowAttachMenu((prev) => !prev)}
            />
            <Show when={props.showActiveTabs}>
              <ActiveTabAttachment
                onAddAttachment={(attachment) => {
                  track(TrackingEvents.CHAT.ATTACHMENT.ADD);
                  props.attachments.addAttachment(attachment);
                }}
                onAddAll={(attachments_) => {
                  attachments_.forEach((attachment) => {
                    track(TrackingEvents.CHAT.ATTACHMENT.ADD);
                    props.attachments.addAttachment(attachment);
                  });
                }}
                attachedAttachments={props.attachments.attached}
                attachAllOnMount={!props.chatId()}
              />
            </Show>
            <ToolsetSelector
              toolset={toolsetSignal}
              sources={[source, setSource]}
            />
          </div>
          <Switch>
            <Match when={props.uploadQueue.uploading().length !== 0}>
              <CircleSpinner />
            </Match>
            <Match when={!generating()}>
              <SendMessageButton
                isDisabled={() => !canSendMessage()}
                onClick={() => {
                  track(TrackingEvents.CHAT.MESSAGE.SEND);
                  sendMessage();
                }}
              />
            </Match>
            <Match when={generating()}>
              <StopButton
                onClick={() => {
                  track(TrackingEvents.CHAT.MESSAGE.STOP);
                  props.onStop?.();
                }}
              />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
