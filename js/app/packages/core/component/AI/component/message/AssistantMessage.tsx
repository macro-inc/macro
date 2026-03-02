import { useSplitLayout } from '@app/component/split-layout/layout';
import { generateTitle } from '@service-cognition/client';
import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { RenderTool } from '@core/component/AI/component/tool/handler';
import { replaceCitations } from '@core/component/LexicalMarkdown/citationsUtils';
import { ENABLE_TTFT } from '@core/constant/featureFlags';
import { createMarkdownFile } from '@core/util/create';
import { PulsingStar } from '@entity/components/PulsingStar';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import NotesIcon from '@phosphor-icons/core/bold/file-md-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import type { AssistantMessagePart } from '@service-cognition/generated/schemas/assistantMessagePart';
import type { ChatMessageContent } from '@service-cognition/generated/schemas/chatMessageContent';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
import { createCallback } from '@solid-primitives/rootless';
import {
  createMemo,
  createSelector,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';

function messageContentIsEmpty(content: ChatMessageContent) {
  if (typeof content === 'string' || Array.isArray(content)) {
    return content.length === 0;
  } else {
    return false;
  }
}

export function extractMessageText(content: ChatMessageContent) {
  if (typeof content === 'string') {
    return content;
  } else if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === 'text') {
          return part.text;
        } else {
          // TODO - handle tool call
          return '';
        }
      })
      .join('\n');
  } else {
    // TODO - handle tool response
    return '';
  }
}

export function AssistantMessage(props: {
  message: ChatMessageWithAttachments;
  isStreaming?: true;
  ttft?: number;
}) {
  // const chat = chatStore.get;
  // const blockData = chatBlockDataSignal.get;
  // const attachments = () => attachedAttachments() ?? [];
  const [copied, setCopied] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);

  // TODO: replace with new layout
  // const { replaceOrInsertSplit } = useSplitLayout();

  let markdownRootRef!: HTMLDivElement;

  // const currentModel = blockData()?.allModels?.find(
  //   (model) => model.name === props.message.model
  // ) ?? { name: 'anthropic/claude-sonnet-4', provider: 'anthropic' };

  // TODO
  // const providerIcon = modelProviderIcon[currentModel];
  // const isGenerating = createMemo(() => {
  //   return (
  //     props.message.id === chat.messages.at(-1)?.id &&
  //     chat.chatStatus === ChatStatus.Generating
  //   );
  // });

  // tool call is complete but the response is not
  const toolUsageMessageIncomplete = createMemo(() => false);
  //   if (!isGenerating()) return false;
  //   const lastMessageContent = props.message.content.at(-1);
  //   if (!lastMessageContent || typeof lastMessageContent === 'string')
  //     return false;
  //   if (
  //     lastMessageContent.type === 'toolCall' ||
  //     lastMessageContent.type === 'text'
  //   )
  //     return false;
  //   return true;
  // });

  const handleCopy = async () => {
    const text = extractMessageText(props.message.content);
    const cleanedText = text.replace(/\[\[.*?\]\]/g, '');
    const html = markdownRootRef?.outerHTML ?? null;
    if (!html) {
      try {
        await navigator.clipboard.writeText(cleanedText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        console.error('Failed to copy text to clipboard');
      }
      return;
    }

    const clipboardItem = new ClipboardItem({
      'text/plain': new Blob([cleanedText], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    });
    let written = false;
    // Try rich and plain first. Not available in all browsers and contexts.
    try {
      await navigator.clipboard.write([clipboardItem]);
      written = true;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback to plain text
    }

    if (!written) {
      try {
        await navigator.clipboard.writeText(cleanedText);
        written = true;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        console.error('Failed to copy text to clipboard');
      }
    }
  };

  // TODO correctly convert to MD
  const handleEditInMarkdown = createCallback(async () => {
    const { replaceOrInsertSplit } = useSplitLayout();
    setIsLoading(true);
    const content: string = await replaceCitations(
      extractMessageText(props.message.content)
    );

    const title = await generateTitle(content.replace(/\[\[.*?\]\]/g, ''));

    const documentId = await createMarkdownFile({
      content,
      title: title ?? `AI Message`,
    });

    if (!documentId) {
      console.error('Error opening AI message in Notes');
      setIsLoading(false);
      return;
    }

    replaceOrInsertSplit({
      type: 'md',
      id: documentId,
    });

    setIsLoading(false);
  });

  return (
    <div
      class="max-w-full flex flex-col justify-start items-start min-w-0 w-full"
      id="assistant-message"
    >
      <Switch>
        <Match when={!messageContentIsEmpty(props.message.content)}>
          <div class="chat-markdown-container max-w-full px-2 w-full">
            <Switch>
              <Match
                when={
                  typeof props.message.content === 'string' &&
                  props.message.content
                }
              >
                {(content) => {
                  if (content().trim().length > 0)
                    return (
                      <ChatMessageMarkdown
                        text={content()}
                        generating={() => false}
                        rootRef={(ref: HTMLDivElement) => {
                          markdownRootRef = ref;
                        }}
                      />
                    );
                }}
              </Match>
              <Match
                when={
                  Array.isArray(props.message.content) && props.message.content
                }
              >
                {(parts) => (
                  <AssistantMessageParts
                    parts={parts()}
                    message={props.message}
                    isStreaming={props.isStreaming ?? false}
                  />
                )}
              </Match>
            </Switch>
            <Show when={toolUsageMessageIncomplete()}>
              <PulsingStar animate kind="streamIndicator" />
            </Show>
          </div>
          <Show when={!props.isStreaming}>
            <div class="flex flex-row w-full justify-start items-center h-[32px] px-2 space-x-2 ">
              <div class="flex flex-row space-x-2 items-center text-xs text-ink-muted">
                {/* Only one model for now so don't show icon */}
                {/*<Dynamic component={modelIcon()} width={12} height={12} />*/}
                {/* <p>{modelName()}</p> */}

                <div class="w-fit">
                  <button
                    class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg p-1 text-xs font-sans"
                    onClick={() => {
                      !isLoading() && handleEditInMarkdown();
                    }}
                  >
                    <Show
                      when={!isLoading()}
                      fallback={<LoadingIcon class="w-3 h-3 animate-spin" />}
                    >
                      <NotesIcon class="w-3 h-3 text-note" />
                    </Show>
                    <p>{isLoading() ? 'Loading Notes' : 'Edit in Notes'}</p>
                  </button>
                </div>
                <div class="w-fit">
                  <button
                    class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg p-1 text-xs font-sans"
                    onClick={handleCopy}
                  >
                    <Show
                      when={!copied()}
                      fallback={<CheckIcon class="w-3 h-3 text-success" />}
                    >
                      <ClipboardIcon class="w-3 h-3" />
                    </Show>
                    <p>{copied() ? 'Copied!' : 'Copy'}</p>
                  </button>
                </div>
                <Show when={props.ttft && ENABLE_TTFT}>
                  <div class="flex flex-row items-center space-x-1 text-xs font-mono bg-panel px-2 py-1">
                    <span class="text-ink-muted">Time to first token:</span>
                    <span class="text-ink font-medium">
                      {props.ttft! / 1000}s
                    </span>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

function AssistantMessageParts(props: {
  parts: AssistantMessagePart[];
  message: ChatMessageWithAttachments;
  isStreaming: boolean;
}) {
  // const chatId = chatStore.get.id;
  // if (!chatId) return;
  const completedToolIds = createMemo(() => {
    const ids = new Set<string>();
    for (const part of props.parts) {
      if (part.type === 'toolCallResponseJson' || part.type === 'toolCallErr') {
        ids.add(part.id);
      }
    }
    return ids;
  });

  const isCompleteSelector = createSelector(
    completedToolIds,
    (id: string, completed) => completed.has(id)
  );

  return (
    <For each={props.parts}>
      {(part, i) => {
        if (part.type === 'toolCall') {
          return (
            <RenderTool
              tool_id={part.id}
              chat_id={'todo'}
              json={part.json}
              name={part.name}
              message_id={props.message.id}
              part_index={i()}
              type="call"
              isComplete={isCompleteSelector(part.id)}
              renderContext={{
                renderContext: {
                  isStreaming: props.isStreaming,
                },
              }}
            />
          );
        } else if (part.type === 'toolCallResponseJson') {
          return (
            <RenderTool
              isComplete={true}
              tool_id={part.id}
              chat_id={'todo'}
              json={part.json}
              name={part.name}
              message_id={props.message.id}
              part_index={i()}
              type="response"
              renderContext={{
                renderContext: {
                  isStreaming: props.isStreaming,
                },
              }}
            />
          );
        } else if (part.type === 'text') {
          if (part.text.trim().length > 0)
            return (
              <ChatMessageMarkdown
                text={part.text}
                generating={() => props.isStreaming}
              />
            );
        }
      }}
    </For>
  );
}
