import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import PaperPlaneRight from '@phosphor/paper-plane-right.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn } from '@ui';
import { batch, createEffect, createSignal, Show, useContext } from 'solid-js';
import { CommentsContext, ThreadContext } from './Thread';

function EditBottomRow(props: {
  handleCancel: (e: MouseEvent) => void;
  handleSend: () => void;
  hideHorizontalPadding?: boolean;
  hasContent?: boolean;
  isSending?: boolean;
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
        disabled={!props.hasContent || props.isSending}
        on:click={props.handleSend}
      >
        <PaperPlaneRight class={cn({ 'text-accent': props.hasContent })} />
      </Button>
    </div>
  );
}

export function EditInput(props: {
  handleCancel: () => void;
  onSend: (newText: string) => unknown | Promise<unknown>;
  hidePadding?: boolean;
  isNewReply?: boolean;
  isNewThread?: boolean;
  isReply?: boolean;
  setEditing?: (newVal: boolean) => void;
  textValue: string;
}) {
  const [editState, setEditState] = createSignal('');
  const [isSending, setIsSending] = createSignal(false);
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

  const handleSend = async () => {
    if (isSending()) return;
    const text = editState();
    if (text.trim().length === 0) return;

    setIsSending(true);
    try {
      await props.onSend(text);
    } finally {
      setIsSending(false);
    }
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
        class="px-2 pt-1 pb-8 bg-surface rounded-sm relative border border-edge focus-within:ring-accent focus-within:ring"
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
            void handleSend();
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
          isSending={isSending()}
        />
      </div>
    </div>
  );
}

export function NewReplyInput(props: {
  createReply: (message: string) => unknown | Promise<unknown>;
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
            class="p-2 mt-2 cursor-default text-sm text-ink-extra-muted bg-surface border border-edge-muted rounded-sm"
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
            const result = props.createReply(message);
            props.setTextValue('');
            return result;
          }}
          isNewReply
          isReply
          setEditing={props.setEditing}
        />
      </Show>
    </div>
  );
}
