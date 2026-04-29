import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import PaperPlaneRight from '@icon/fill/paper-plane-right-fill.svg';
import XIcon from '@icon/regular/x.svg';
import { batch, createEffect, createSignal, Show, useContext } from 'solid-js';
import { CommentsContext, ThreadContext } from './Thread';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';

export function EditBottomRow(props: {
  handleCancel: (e: MouseEvent) => void;
  handleSend: () => void;
  hideHorizontalPadding?: boolean;
  hasContent?: boolean;
}) {
  return (
    <div class="absolute bottom-1 right-1 flex items-center">
      <Button
        tooltip="Delete Draft"
        size="icon-sm"
        class="rounded-xs"
        variant="ghost"
        on:click={props.handleCancel}
      >
        <XIcon />
      </Button>

      <Button
        tooltip="Send Comment"
        size="icon-sm"
        class="rounded-xs"
        variant="ghost"
        disabled={!props.hasContent}
        on:click={props.handleSend}
      >
        <PaperPlaneRight class={cn({ 'text-accent': props.hasContent })} />
      </Button>
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
        class="px-2 pt-1 pb-8 bg-input rounded-sm relative border border-edge-muted focus-within:ring-accent focus-within:ring"
        on:click={(e) => {
          e.stopPropagation();
          focusEditor();
        }}
      >
        <MarkdownTextarea
          class="text-sm wrap-break-word text-ink"
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
            class="px-2 py-2 mt-2 cursor-default text-sm text-ink-extra-muted bg-input/50 border border-edge-muted rounded-sm"
            on:click={(e) => {
              e.stopPropagation();
              props.setEditing(true);
            }}
          >
            Reply...
          </div>
        }
      >
        <div class="h-2"></div>
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
