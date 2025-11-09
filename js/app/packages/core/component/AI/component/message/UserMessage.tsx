import type { Model, Send } from '@core/component/AI/types';
import { isDssImage, isImageAttachment } from '@core/component/AI/util';
import { IconButton } from '@core/component/IconButton';
import { ImagePreview } from '@core/component/ImagePreview';
import { ItemPreview } from '@core/component/ItemPreview';
import PencilIcon from '@icon/regular/note-pencil.svg';
import QuoteIcon from '@phosphor-icons/core/bold/arrow-elbow-down-right-bold.svg?component-solid';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
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
    makeEdit: (edit: Send) => void;
    chatId: string;
  };
}) {
  const [isEditing, setIsEditing] = createSignal(false);

  const cn = () => {
    let quote;
    let content;
    const messageContent = props.message.content as string;
    if (messageContent.startsWith('<quote>')) {
      let start = messageContent.indexOf('<quote>');
      let end = messageContent.indexOf('</quote>');
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
    return rawContent || undefined;
  };

  const imageAttachments = () =>
    props.message.attachments.filter((a) => isImageAttachment(a));

  const itemPreviewAttachments = () =>
    props.message.attachments.filter(
      (a) =>
        !isImageAttachment(a) &&
        ['channel', 'document', 'email'].includes(a.attachmentType)
    );

  return (
    <div class="flex flex-col space-y-2 group">
      <Show when={quote()}>
        <div class="relative w-full text-xs flex flex-row space-x-2 justify-end items-start text-ink-muted">
          <div class="flex flex-row items-center space-x-3">
            <QuoteIcon class="w-3 h-3 shrink-0" />
            <p>"{quote()?.substring(0, 300)}..."</p>
          </div>
        </div>
      </Show>
      <Show when={props.message.attachments.length > 0}>
        <div class="flex flex-col space-y-2 items-end justify-end w-auto px-1 pb-1 pl-4 mb-2">
          <For each={imageAttachments()}>
            {(attachment) => (
              <ImagePreview
                id={attachment.attachmentId}
                variant="small"
                isCurrentUser={true}
                isDss={isDssImage(attachment)}
              />
            )}
          </For>
          <For each={itemPreviewAttachments()}>
            {(attachment) => (
              <ItemPreview
                itemId={attachment.attachmentId}
                // TODO: improve typing for item preview attachments
                itemType={attachment.attachmentType as 'channel' | 'document'}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={content()}>
        <div class="flex flex-row justify-end w-auto items-center">
          <Switch>
            <Match when={!isEditing()}>
              <Show when={props.edit}>
                <IconButton
                  icon={PencilIcon}
                  theme="clear"
                  onClick={() => setIsEditing(true)}
                />
              </Show>
              <div class="text-align-right! bg-message sender-message px-3.5 w-auto max-w-[80%] py-1.5 whitespace-pre-line relative">
                <ChatMessageMarkdown
                  generating={() => false}
                  text={content()!}
                />
              </div>
            </Match>
            <Match when={isEditing()}>
              <EditableChatMessage
                chatId={props.edit!.chatId}
                attachments={props.message.attachments}
                initialText={props.message.content.toString()}
                model={(props.message.model as Model) ?? DEFAULT_MODEL}
                onAccept={props.edit!.makeEdit}
                onCancel={() => setIsEditing(false)}
              />
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
}
