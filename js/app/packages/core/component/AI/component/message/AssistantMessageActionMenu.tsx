import { structuredOutputCompletion } from '@core/client/structuredOutput';
import {
  DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  MODEL_PROVIDER_ICON,
} from '@core/component/AI/constant/model';
import { replaceCitations } from '@core/component/LexicalMarkdown/citationsUtils';
import { createFromMarkdownText } from '@core/util/md';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import NotesIcon from '@phosphor-icons/core/bold/file-md-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import type { ChatMessageContent } from '@service-cognition/generated/schemas/chatMessageContent';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
import type { Model } from '@service-cognition/generated/schemas/model';
import { createCallback } from '@solid-primitives/rootless';
import { useSplitLayout } from 'app/component/split-layout/layout';
import type { Component } from 'solid-js';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type AssistantActionProps = {
  message: ChatMessageWithAttachments;
};

export function AssistantMessageActionAndMetadata(props: AssistantActionProps) {
  const modelName = () => {
    const prettyName: string | undefined =
      MODEL_PRETTYNAME[props.message?.model as Model];
    if (!prettyName) return MODEL_PRETTYNAME[DEFAULT_MODEL];
    return prettyName;
  };

  const modelIcon = () => {
    const icon: Component | undefined =
      MODEL_PROVIDER_ICON[props.message?.model as Model];
    if (!icon) return MODEL_PROVIDER_ICON[DEFAULT_MODEL];
    return icon;
  };

  function extractMessageText(content: ChatMessageContent) {
    if (typeof content === 'string') {
      return content;
    } else if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part.type === 'text') {
            return part.text;
          } else if (part.type === 'toolCall') {
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

  const handleCopy = async () => {
    const text = extractMessageText(props.message.content);
    const cleanedText = text.replace(/\[\[.*?\]\]/g, '');

    const clipboardItem = new ClipboardItem({
      'text/plain': new Blob([cleanedText], { type: 'text/plain' }),
    });
    let written = false;
    // try rich and plain first. Not avail in all browsers and contexts.
    try {
      await navigator.clipboard.write([clipboardItem]);
      written = true;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}

    if (!written) {
      try {
        await navigator.clipboard.writeText(cleanedText);
        written = true;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  };

  const [copied, setCopied] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const { insertSplit } = useSplitLayout();
  const handleEditInMarkdown = createCallback(async () => {
    setIsLoading(true);
    const content: string = await replaceCitations(
      extractMessageText(props.message.content)
    );

    const title: string | undefined = await generateTitleForMarkdown(
      content.replace(/\[\[.*?\]\]/g, '')
    );

    const maybeDoc = await createFromMarkdownText({
      markdown: content,
      title: title ?? `AI Message`,
      preserveNewLines: false,
    });

    if ('error' in maybeDoc) {
      console.error('Error opening AI message in Notes', maybeDoc.error);
      setIsLoading(false);
      return;
    }

    const documentId = maybeDoc.documentId;
    if (!documentId) {
      setIsLoading(false);
      return;
    }

    insertSplit({
      type: 'md',
      id: documentId,
    });
    setIsLoading(false);
  });

  async function generateTitleForMarkdown(markdownText: string) {
    try {
      const schema = {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              'A concise and informative title that describes the following markdown text',
          },
        },
        required: ['title'],
        additionalProperties: false,
      };

      const result = await structuredOutputCompletion(
        `Generate a concise and informative title that describes the following markdown text:\n\n${markdownText}`,
        schema,
        'markdown_title_generator'
      );

      if (
        typeof result === 'object' &&
        result !== null &&
        'title' in result &&
        typeof result.title === 'string'
      ) {
        return result.title;
      }
    } catch (e) {
      console.error(e);
    }
    return undefined;
  }

  return (
    <div class="flex flex-row w-full justify-start items-center h-[32px] px-2 space-x-2">
      <div class="flex flex-row space-x-2 items-center text-xs text-ink-muted">
        <Dynamic component={modelIcon()} width={12} height={12} />
        <p>{modelName()}</p>

        <Switch>
          <Match when={!isLoading()}>
            <button
              class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
              onClick={handleEditInMarkdown}
            >
              <NotesIcon class="w-3 h-3 text-note" />
            </button>
          </Match>
          <Match when={isLoading()}>
            <LoadingIcon class="w-3 h-3 animate-spin" />
          </Match>
        </Switch>
        <div class="w-fit">
          <button
            class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
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
      </div>
    </div>
  );
}
