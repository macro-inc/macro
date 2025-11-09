import { IconButton } from '@core/component/IconButton';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import PaperPlaneRight from '@icon/fill/paper-plane-right-fill.svg';
import XIcon from '@icon/regular/x.svg';
import { batch, createEffect, createSignal, Show, useContext } from 'solid-js';
import { CommentsContext, ThreadContext } from './Thread';

export function EditBottomRow(props: {
  handleCancel: (e: MouseEvent) => void;
  handleSend: () => void;
  hideHorizontalPadding?: boolean;
  hasContent?: boolean;
}) {
  return (
    <div class="absolute bottom-1 right-1 flex items-center">
      <IconButton
        tooltip={{ label: 'Delete Draft' }}
        icon={XIcon}
        on:click={props.handleCancel}
        theme="muted"
      />
      <IconButton
        tooltip={{ label: 'Send Comment' }}
        icon={PaperPlaneRight}
        on:click={props.handleSend}
        theme={props.hasContent ? 'accent' : 'muted'}
        class={props.hasContent ? '' : 'opacity-10'}
      />
    </div>
  );
}

export function EditInput(props: {
  handleCancel: () => void;
  onSend: (newText: string) => void;
  hidePadding?: boolean;
  isNewReply?: boolean;
  isNewThread?: boolean;
  isReply?: boolean;
  setEditing?: (newVal: boolean) => void;
  textValue: string;
}) {
  const [editState, setEditState] = createSignal('');
  const { setActiveThread } = useContext(CommentsContext);
  const { mentionsSignal } = useContext(ThreadContext);
  const [, setMentions] = mentionsSignal;

  createEffect(() => {
    setEditState(props.textValue);
  });

  let focusEditor = () => {};

  const stopEditingAndCancel = (e: MouseEvent) => {
    batch(() => {
      e.stopPropagation();
      props.handleCancel();
      props.setEditing?.(false);
      setActiveThread(null);
      setMentions([]);
    });
  };

  const handleSend = () => {
    props.onSend(editState());
  };

  const onRemoveMention = (itemMention: ItemMention) => {
    if (itemMention.itemType !== 'user') return;
    setMentions((prev) =>
      prev.filter((mention) => !mention.mentions.includes(itemMention.itemId))
    );
  };

  return (
    <div class="relative">
      <div
        class="px-2 pt-1 pb-8 relative border-1 border-edge/50 focus-within:bracket focus-within:border-accent"
        on:click={(e) => {
          e.stopPropagation();
          focusEditor();
        }}
      >
        <MarkdownTextarea
          class="text-sm break-words text-ink"
          editable={() => true}
          onChange={(value) => {
            setEditState(value);
          }}
          initialValue={props.textValue}
          type="markdown"
          onEnter={() => {
            handleSend();
            return true;
          }}
          placeholder="Add a comment..."
          focusOnMount
          onUserMention={(mention) => {
            setMentions((prev) => [...prev, mention]);
          }}
          onFocusReady={(focusFn) => {
            focusEditor = focusFn;
          }}
          onRemoveMention={onRemoveMention}
        />
        <EditBottomRow
          handleCancel={stopEditingAndCancel}
          handleSend={handleSend}
          hideHorizontalPadding={props.hidePadding}
          hasContent={editState().trim().length > 0}
        />
      </div>
    </div>
  );
}

export function NewReplyInput(props: {
  createReply: (message: string) => void;
  isEditing: boolean;
  setEditing: (newVal: boolean) => void;
  setTextValue: (newVal: string) => void;
  textValue: string;
}) {
  return (
    <div class="flex flex-col">
      <Show
        when={props.isEditing}
        fallback={
          <div
            class="px-2 pt-2 pb-2 cursor-default text-sm text-ink-extra-muted border-1 border-edge/50"
            on:click={(e) => {
              e.stopPropagation();
              props.setEditing(true);
            }}
          >
            Reply...
          </div>
        }
      >
        <EditInput
          textValue={props.textValue}
          handleCancel={() => props.setTextValue('')}
          onSend={(message) => {
            props.createReply(message);
            props.setTextValue('');
          }}
          isNewReply
          isReply
          setEditing={props.setEditing}
        />
      </Show>
    </div>
  );
}
