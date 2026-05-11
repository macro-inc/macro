import {
  DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  MODEL_PROVIDER_ICON,
} from '@core/component/AI/constant/model';
import { replaceCitations } from '@core/component/LexicalMarkdown/citationsUtils';
import { createMarkdownFile } from '@core/util/create';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import NotesIcon from '@phosphor-icons/core/bold/file-md-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { generateTitle } from '@service-cognition/client';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
import { createCallback } from '@solid-primitives/rootless';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { extractMessageText } from './AssistantMessage';

type AssistantActionProps = {
  message: ChatMessageWithAttachments;
};

export function AssistantMessageActionAndMetadata(props: AssistantActionProps) {
  const modelName = () => {
    return MODEL_PRETTYNAME[DEFAULT_MODEL];
  };

  const modelIcon = () => {
    return MODEL_PROVIDER_ICON[DEFAULT_MODEL];
  };

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

    insertSplit({
      type: 'md',
      id: documentId,
    });
    setIsLoading(false);
  });

  return (
    <div class="flex flex-row w-full justify-start items-center h-8 px-2 space-x-2">
      <div class="flex flex-row space-x-2 items-center text-xs text-ink-muted">
        <Dynamic component={modelIcon()} width={12} height={12} />
        <p>{modelName()}</p>

        <Switch>
          <Match when={!isLoading()}>
            <button
              class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
              onClick={handleEditInMarkdown}
            >
              <NotesIcon class="size-3 text-note" />
            </button>
          </Match>
          <Match when={isLoading()}>
            <LoadingIcon class="size-3 animate-spin" />
          </Match>
        </Switch>
        <div class="w-fit">
          <button
            class="flex flex-row items-center space-x-1 hover:bg-hover hover-transition-bg rounded-md p-1 text-xs font-sans"
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
      </div>
    </div>
  );
}
