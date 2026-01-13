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
import { BrightJoins } from '@ui/components/BrightJoins';
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

  return (
    <div
      id="chat-input"
      ref={containerRef}
      class="relative flex flex-col flex-1 items-center justify-between bg-input border-t border-x border-edge-muted rounded-t-[5px] -mb-[7px]"
    >
      <BrightJoins dots={[false, false, true, true]} />
      <div class="relative w-full z-0 px-3 pt-2 sm:pb-4 flex-1 overflow-hidden placeholder:text-ink-placeholder placeholder:opacity-50">
        <div
          id="chat-input-text-area"
          class="rounded-md w-full h-full text-base sm:text-sm text-ink"
        >
          <props.markdown.MarkdownArea
            onEnter={handleEnter}
            placeholder="Ask AI -  @mention anything"
            history={availableAttachments}
            dontFocusOnMount={
              isTouchDevice() || props.autoFocusOnMount === false
            }
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
        <div class="flex flex-row w-full h-8 justify-between items-center p-2 mb-2 space-x-2 allow-css-brackets">
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
          <div class="flex flex-row items-center gap-2">
            <DeprecatedIconButton
              icon={showAttachMenu() ? XIcon : PlusIcon}
              theme="base"
              ref={setAttachMenuAnchorRef}
              onClick={() => setShowAttachMenu((prev) => !prev)}
            />
          </div>

          <div class="flex flex-col items-end text-xs leading-tight text-ink-disabled">
            <Switch>
              <Match when={!isTouchDevice()}>
                <div class="text-xs flex flex-col gap-1 opacity-70 items-end absolute bottom-1">
                  <Show when={generating()}>
                    <Tooltip tooltip="ctrl+c to stop" placement="top">
                      <div
                        class="flex items-center gap-1.5"
                        classList={{
                          'text-accent': pressedKeys().has('ctrl'),
                        }}
                      >
                        <span class="">Stop</span>
                        <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
                          <Hotkey shortcut="ctrl+c" />
                        </div>
                      </div>
                    </Tooltip>
                  </Show>
                  <Tooltip tooltip="Enter to send with Haiku" placement="top">
                    <div class="flex items-center gap-1.5">
                      <span class="">Haiku</span>
                      <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
                        <Hotkey shortcut="Enter" />
                      </div>
                    </div>
                  </Tooltip>
                  <Tooltip
                    tooltip={`${modifierMap.cmd} + Enter to send with Opus`}
                    placement="top"
                  >
                    <div
                      class="flex items-center gap-1.5"
                      classList={{
                        'text-accent': pressedKeys().has('cmd'),
                      }}
                    >
                      <span>Opus</span>
                      <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
                        <Hotkey shortcut={'meta+Enter'} />
                      </div>
                    </div>
                  </Tooltip>
                </div>
              </Match>
              <Match when={isTouchDevice()}>
                <div class="flex flex-row gap-1 items-center">
                  <Show when={!generating()}>
                    <Button
                      onClick={() => sendMessage('claude-opus-4-5')}
                      class=""
                    >
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
          </div>
        </div>
      </div>
    </div>
  );
}
