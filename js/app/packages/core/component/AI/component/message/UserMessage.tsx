import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ImagePreview } from '@core/component/ImagePreview';
import { ItemPreview } from '@core/component/ItemPreview';
import PencilIcon from '@phosphor/note-pencil.svg';
import QuoteIcon from '@phosphor-icons/core/bold/arrow-elbow-down-right-bold.svg?component-solid';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
import { Button, Layer } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { DEFAULT_MODEL } from '../../constant';
import { ChatMessageMarkdown } from './ChatMessageMarkdown';
import { EditableChatMessage } from './EditableChatMessage';

// Function to insert soft hyphens into long words / urls / etc so that they won't lock the width
function insertSoftHyphens(text: string): string {
  const words = text.split(' ');
  const softHyphen = '\u00AD';

  const wrappedWords = words.map((word) => {
    if (word.length > 20) {
      let result = '';
      for (let i = 0; i < word.length; i += 10) {
        result +=
          word.slice(i, i + 10) + (i + 10 < word.length ? softHyphen : '');
      }
      return result;
    }
    return word;
  });

  return wrappedWords.join(' ');
}

export function UserMessage(props: {
  message: ChatMessageWithAttachments;
  edit?: {
    makeEdit?: (edit: ChatSendInput) => void;
    chatId: string;
  };
}) {
  const [isEditing, setIsEditing] = createSignal(false);

  const cn = () => {
    let quote;
    let content;
    const messageContent = props.message.content as string;
    if (messageContent.startsWith('<quote>')) {
      const start = messageContent.indexOf('<quote>');
      const end = messageContent.indexOf('</quote>');
      quote = messageContent.substring(start + 7, end);
      content = messageContent.substring(end + 9);
      return [quote, content];
    }
    return [undefined, messageContent];
  };

  const quote = () => {
    const rawQuote = cn()[0];
    return rawQuote ? insertSoftHyphens(rawQuote) : undefined;
  };

  const content = () => {
    const rawContent = cn()[1];
    return rawContent?.trim() ? rawContent : undefined;
  };

  const imageAttachments = () =>
    props.message.attachments.filter((a) => a.entity_type === 'static_file');

  const itemPreviewAttachments = () =>
    props.message.attachments.filter((a) =>
      ['channel', 'document', 'email_thread', 'project'].includes(a.entity_type)
    );

  return (
    <div class="flex flex-col group">
      <Show when={quote()}>
        <div class="relative w-full text-xs flex flex-row space-x-2 items-start text-ink-muted">
          <div class="flex flex-row items-center space-x-3">
            <QuoteIcon class="size-3 shrink-0" />
            <p>"{quote()?.substring(0, 300)}..."</p>
          </div>
        </div>
      </Show>
      <Show when={props.message.attachments.length > 0}>
        <div class="flex flex-col items-end gap-1 ml-auto max-w-[calc(100%-8rem)] mb-2">
          <For each={imageAttachments()}>
            {(attachment) => (
              <ImagePreview
                image={{ id: attachment.entity_id }}
                variant="small"
                isDss={false}
              />
            )}
          </For>
          <For each={itemPreviewAttachments()}>
            {(attachment) => (
              <div class="max-w-full overflow-hidden p-[0.5px]">
                <ItemPreview
                  id={attachment.entity_id}
                  type={
                    (attachment.entity_type === 'email_thread'
                      ? 'email'
                      : attachment.entity_type) as
                      | 'channel'
                      | 'document'
                      | 'email'
                      | 'project'
                  }
                  class="max-w-full"
                />
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={content()}>
        <div class="flex flex-row w-full items-center">
          <Switch>
            <Match when={!isEditing()}>
              <Layer depth={0}>
                <div class="relative ml-auto max-w-[calc(100%-8rem)] whitespace-pre-line overflow-hidden rounded-lg border border-edge-muted bg-surface px-3 py-2 text-ink">
                  <ChatMessageMarkdown
                    generating={() => false}
                    text={content()!}
                  />
                  <Show when={props.edit}>
                    <div class="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-md"
                        onClick={() => setIsEditing(true)}
                      >
                        <PencilIcon />
                      </Button>
                    </div>
                  </Show>
                </div>
              </Layer>
            </Match>
            <Match when={isEditing()}>
              <EditableChatMessage
                chatId={props.edit!.chatId}
                attachments={props.message.attachments}
                initialText={props.message.content.toString()}
                model={DEFAULT_MODEL}
                onAccept={() => {}}
                onCancel={() => setIsEditing(false)}
              />
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
}
