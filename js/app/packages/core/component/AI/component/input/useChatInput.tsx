import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import { withAnalytics } from '@coparse/analytics';
import { useBuildChatSendRequest } from '@core/component/AI/component/input/buildRequest';
import { DEFAULT_MODEL, SMART_MODE_MODEL } from '@core/component/AI/constant';
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
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { Hotkey, modifierMap } from '@core/component/Hotkey';
import { Tooltip } from '@core/component/Tooltip';
import { pressedKeys } from '@core/hotkey/state';
import PlusIcon from '@icon/regular/plus.svg';
import XIcon from '@icon/regular/x.svg';
import Stop from '@phosphor-icons/core/regular/stop.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui/components/Button';
import type { LexicalEditor } from 'lexical';
import type { Accessor, Component, Setter } from 'solid-js';
import { createEffect, createSignal, Match, on, Show, Switch } from 'solid-js';
import { useTabAttachments } from '../../signal/tabAttachments';
import { AttachmentList } from './Attachment';
import { ChatAttachMenu } from './ChatAttachMenu';
import type { Source } from './ToolsetSelector';
import {
  type UseChatMarkdown,
  useChatMarkdownArea,
} from './useChatMarkdownArea';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

const { track, TrackingEvents } = withAnalytics();

export type ChatInputProps = {
  onSend: (args: CreateAndSend | Send) => void;
  onStop?: () => void;
  isPersistent?: boolean;
  showActiveTabs?: boolean;
  captureEditor?: (editor: LexicalEditor) => void;
  autoFocusOnMount?: boolean;
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

  const tabAttachments = useTabAttachments();
  createEffect(
    on(tabAttachments, (tabs, p) => {
      for (const prev of p ?? []) {
        // remove stuff from closed tabs
        if (!tabs.find((t) => t.attachmentId === prev.attachmentId)) {
          attachments.removeAttachment(prev.attachmentId);
        }
      }
      for (const tab of tabs) {
        attachments.addAttachment(tab);
      }
    })
  );

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
  let containerRef!: HTMLDivElement;
  const generating = props.isGenerating ?? (() => false);
  const toolsetSignal = createSignal<ToolSet>({ type: 'all' });

  const [source] = createSignal<Source>('everything');
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

  const LINE_HEIGHT_THRESHOLD = 32;
  const isMultiline = () => {
    // Access markdownText to create reactive dependency
    props.markdown.markdownText();
    const ref = props.markdown.ref();
    if (!ref) return false;
    return ref.scrollHeight > LINE_HEIGHT_THRESHOLD;
  };

  const buildChatSendRequest = useBuildChatSendRequest();

  const sendMessage = createCallback(async (modelOverride?: Model) => {
    if (!canSendMessage()) return;

    const request = await buildChatSendRequest({
      chatId: props.chatId(),
      userRequest: props.markdown.markdownText(),
      isPersistent: props.isPersistent,
      attachments: props.attachments.attached(),
      model: modelOverride ?? props.model(),
      toolset: toolsetSignal[0](),
      source: source(),
    });
    props.markdown.clear();
    props.onSend(request);
  });

  function handleEnter(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      if (canSendMessage()) {
        if (e.metaKey) {
          sendMessage(SMART_MODE_MODEL);
        } else {
          sendMessage();
        }
      }
      return true;
    } else {
      return false;
    }
  }

  const availableAttachments = useChatAttachableHistory();

  const hasAttachments = () =>
    props.attachments.attached().length > 0 ||
    props.uploadQueue.uploading().length > 0;

  const LeftButton = () => (
    <div ref={setAttachMenuAnchorRef} class="shrink-0">
      <DeprecatedIconButton
        icon={showAttachMenu() ? XIcon : PlusIcon}
        theme="base"
        onClick={() => setShowAttachMenu((prev) => !prev)}
      />
    </div>
  );

  const RightControls = () => (
    <Switch>
      <Match when={!isTouchDevice()}>
        <div class="flex flex-row items-center gap-3 text-xs text-ink-disabled opacity-70 shrink-0">
          <Show when={generating()}>
            <Tooltip tooltip="ctrl+c to stop" placement="top">
              <div
                class="flex items-center gap-1"
                classList={{
                  'text-accent': pressedKeys().has('ctrl'),
                }}
              >
                <span>Stop</span>
                <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1 py-0.5">
                  <Hotkey shortcut="ctrl+c" />
                </div>
              </div>
            </Tooltip>
          </Show>
          <Tooltip tooltip="Enter to send with Haiku" placement="top">
            <div class="flex items-center gap-1">
              <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1 py-0.5">
                <Hotkey shortcut="Enter" />
              </div>
              <span>Haiku</span>
            </div>
          </Tooltip>
          <Tooltip
            tooltip={`${modifierMap.cmd} + Enter to send with Opus`}
            placement="top"
          >
            <div
              class="flex items-center gap-1"
              classList={{
                'text-accent': pressedKeys().has('cmd'),
              }}
            >
              <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1 py-0.5">
                <Hotkey shortcut={'meta+Enter'} />
              </div>
              <span>Opus</span>
            </div>
          </Tooltip>
        </div>
      </Match>
      <Match when={isTouchDevice()}>
        <div class="flex flex-row gap-1 items-center shrink-0">
          <Show when={!generating()}>
            <Button onClick={() => sendMessage('claude-opus-4-5')}>
              <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center">
                <ArrowUp class="group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out" />
              </div>
            </Button>
          </Show>
          <Show when={generating()}>
            <Button
              onClick={() => (props.onStop ? props.onStop() : [])}
              class="text-ink-muted hover:scale-115 transition ease-in-out flex-col items-center rounded-full p-[0.25lh] hover:bg-transparent"
            >
              <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center p-0">
                <Stop class="group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out" />
              </div>
            </Button>
          </Show>
        </div>
      </Match>
    </Switch>
  );

  return (
    <div
      id="chat-input"
      ref={containerRef}
      class="relative flex flex-col bg-input border border-edge-muted rounded-md transition-all duration-150"
    >
      <Show when={hasAttachments()}>
        <div class="px-2 pt-2 w-full">
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
      </Show>

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

      <div class="relative px-2 py-1.5">
        <div
          id="chat-input-text-area"
          class="text-base sm:text-sm text-ink transition-all duration-150 ease-out"
          classList={{
            'pl-8 pr-[180px]': !isMultiline(),
            'pl-0 pr-0 pb-8': isMultiline(),
          }}
        >
          <props.markdown.MarkdownArea
            onEnter={handleEnter}
            placeholder="Ask AI - @mention anything"
            history={availableAttachments}
            dontFocusOnMount={
              isTouchDevice() || props.autoFocusOnMount === false
            }
            onPasteFile={props.uploadQueue.upload}
            captureEditor={props.captureEditor}
          />
        </div>

        <div
          class="absolute left-2 transition-all duration-150 ease-out"
          classList={{
            'top-1/2 -translate-y-1/2': !isMultiline(),
            'bottom-1.5 top-auto translate-y-0': isMultiline(),
          }}
        >
          <LeftButton />
        </div>

        <div
          class="absolute right-2 transition-all duration-150 ease-out"
          classList={{
            'top-1/2 -translate-y-1/2': !isMultiline(),
            'bottom-1.5 top-auto translate-y-0': isMultiline(),
          }}
        >
          <RightControls />
        </div>
      </div>
    </div>
  );
}
