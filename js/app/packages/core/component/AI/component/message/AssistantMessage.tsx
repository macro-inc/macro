import { useSplitLayout } from '@app/component/split-layout/layout';
import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { ThinkingBlock } from '@core/component/AI/component/message/ThinkingBlock';
import { RenderTool } from '@core/component/AI/component/tool/handler';
import { McpToolCall } from '@core/component/AI/component/tool/McpToolCall';
import { useChatContext } from '@core/component/AI/context';
import { replaceCitations } from '@core/component/LexicalMarkdown/citationsUtils';
import { ENABLE_TTFT } from '@core/constant/featureFlags';
import { createMarkdownFile } from '@core/util/create';
import { PulsingStar } from '@entity/components/PulsingStar';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import NotesIcon from '@phosphor-icons/core/bold/file-md-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { generateTitle } from '@service-cognition/client';
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
  mapArray,
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

function extractMessageText(content: ChatMessageContent) {
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
  const [copied, setCopied] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  let markdownRootRef!: HTMLDivElement;

  const toolUsageMessageIncomplete = createMemo(() => false);
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
          <div class="chat-markdown-container max-w-full px-4 w-full">
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
            <div class="flex flex-row w-full justify-start items-center h-8 px-4 space-x-2">
              <div class="flex flex-row space-x-2 items-center text-xs text-ink-muted">
                <div class="w-fit">
                  <button
                    class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg p-1 text-xs font-sans"
                    onClick={() => {
                      !isLoading() && handleEditInMarkdown();
                    }}
                  >
                    <Show
                      when={!isLoading()}
                      fallback={<LoadingIcon class="size-3 animate-spin" />}
                    >
                      <NotesIcon class="size-3 text-note" />
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
                      fallback={<CheckIcon class="size-3 text-success" />}
                    >
                      <ClipboardIcon class="size-3" />
                    </Show>
                    <p>{copied() ? 'Copied!' : 'Copy'}</p>
                  </button>
                </div>
                <Show when={props.ttft && ENABLE_TTFT}>
                  <div class="flex flex-row items-center space-x-1 text-xs font-mono bg-surface px-2 py-1">
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

function getAssistantPartKey(
  part: AssistantMessagePart,
  counts: Map<AssistantMessagePart['type'], number>
): string {
  if (part.type === 'toolCall' || part.type === 'toolCallErr') {
    return `${part.type}:${part.id}`;
  }

  const count = counts.get(part.type) ?? 0;
  counts.set(part.type, count + 1);
  return `${part.type}:${count}`;
}

function AssistantMessageParts(props: {
  parts: AssistantMessagePart[];
  message: ChatMessageWithAttachments;
  isStreaming: boolean;
}) {
  const chat = useChatContext();
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

  const responseById = createMemo(() => {
    const responseMap = new Map<
      string,
      Extract<AssistantMessagePart, { type: 'toolCallResponseJson' }>
    >();

    for (const part of props.parts) {
      if (part.type === 'toolCallResponseJson') {
        responseMap.set(part.id, part);
      }
    }

    return responseMap;
  });

  const parts = createMemo(() => {
    return props.parts.filter(
      (part) =>
        part.type !== 'toolCallResponseJson' && part.type !== 'toolCallErr'
    );
  });

  const isThinkingDone = createMemo(() => {
    if (!props.isStreaming) return true;
    const p = parts();
    return p.some((part) => part.type !== 'thinking');
  });

  const keyedParts = createMemo(() => {
    const counts = new Map<AssistantMessagePart['type'], number>();
    const partsByKey = new Map<string, AssistantMessagePart>();
    const orderedKeys: string[] = [];

    for (const part of parts()) {
      const key = getAssistantPartKey(part, counts);
      orderedKeys.push(key);
      partsByKey.set(key, part);
    }

    return { orderedKeys, partsByKey };
  });

  const stableParts = mapArray(
    () => keyedParts().orderedKeys,
    (key) => createMemo(() => keyedParts().partsByKey.get(key))
  );

  return (
    <For each={stableParts()}>
      {(part, i) => {
        const currentPart = () => part();
        if (!currentPart()) return null;

        const type = () => currentPart()?.type;

        return (
          <Switch>
            <Match when={type() === 'toolCall'}>
              {(() => {
                const toolCall = () =>
                  currentPart() as Extract<
                    AssistantMessagePart,
                    { type: 'toolCall' }
                  >;
                return (
                  <RenderTool
                    tool_id={toolCall().id}
                    chat_id={chat.chatId()}
                    json={toolCall().json}
                    name={toolCall().name}
                    response={responseById().get(toolCall().id)}
                    message_id={props.message.id}
                    part_index={i()}
                    isComplete={isCompleteSelector(toolCall().id)}
                    renderContext={{
                      renderContext: {
                        isStreaming: props.isStreaming,
                      },
                    }}
                  />
                );
              })()}
            </Match>
            <Match when={type() === 'mcpToolCall'}>
              {(() => {
                const mcpCall = () =>
                  currentPart() as Extract<
                    AssistantMessagePart,
                    { type: 'mcpToolCall' }
                  >;
                return (
                  <McpToolCall
                    name={mcpCall().name}
                    service={mcpCall().service}
                    display_name={mcpCall().display_name ?? undefined}
                    isComplete={isCompleteSelector(mcpCall().id)}
                    renderContext={{
                      renderContext: {
                        isStreaming: props.isStreaming,
                      },
                    }}
                  />
                );
              })()}
            </Match>
            <Match when={type() === 'text'}>
              {(() => {
                const text = () => {
                  const p = currentPart();
                  return p?.type === 'text' ? p.text : '';
                };
                return (
                  <Show when={text().trim().length > 0}>
                    <ChatMessageMarkdown
                      text={text()}
                      generating={() => props.isStreaming}
                    />
                  </Show>
                );
              })()}
            </Match>
            <Match when={type() === 'thinking'}>
              {(() => {
                const thinking = () => {
                  const p = currentPart();
                  return p?.type === 'thinking' ? p.thinking : '';
                };
                return (
                  <Show when={thinking().trim().length > 0}>
                    <ThinkingBlock
                      thinking={thinking()}
                      isStreaming={!isThinkingDone()}
                    />
                  </Show>
                );
              })()}
            </Match>
          </Switch>
        );
      }}
    </For>
  );
}
