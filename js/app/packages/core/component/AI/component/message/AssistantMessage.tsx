import { useSplitLayout } from '@app/component/split-layout/layout';
import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { replaceCitations } from '@core/component/LexicalMarkdown/citationsUtils';
import { ENABLE_TTFT } from '@core/constant/featureFlags';
import { createMarkdownFile } from '@core/util/create';
import { PulsingStar } from '@entity/components/PulsingStar';
import WideFileMd from '@icon/wide-file-md.svg';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { generateTitle } from '@service-cognition/client';
import type { ChatMessageContent } from '@service-cognition/generated/schemas/chatMessageContent';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { createMemo, createSignal, Match, Show, Switch } from 'solid-js';
import { AssistantMessageParts } from './AssistantMessageParts';

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
          <div class="chat-markdown-container max-w-full w-full">
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
            <div class="flex flex-row w-full justify-start items-center h-8 space-x-2">
              <div class="flex flex-row space-x-1 items-center text-xs text-ink-extra-muted opacity-50">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  noTouchResize
                  class="p-1 text-ink-extra-muted hover:text-ink-muted"
                  tooltip={
                    isLoading()
                      ? 'Opening assistant response in Notes'
                      : 'Edit assistant response in Notes'
                  }
                  onClick={() => {
                    !isLoading() && handleEditInMarkdown();
                  }}
                >
                  <Show
                    when={!isLoading()}
                    fallback={<LoadingIcon class="animate-spin" />}
                  >
                    <WideFileMd />
                  </Show>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  noTouchResize
                  class="p-1 text-ink-extra-muted hover:text-ink-muted"
                  tooltip={
                    copied()
                      ? 'Copied assistant response'
                      : 'Copy assistant response'
                  }
                  onClick={handleCopy}
                >
                  <Show when={!copied()} fallback={<CheckIcon />}>
                    <ClipboardIcon />
                  </Show>
                </Button>
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
