import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import XIcon from '@phosphor/x.svg';
import { Button, cn, SendButton } from '@ui';
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
    <div class="absolute bottom-2 right-2 flex items-center gap-1">
      <Button
        tooltip="Delete Draft"
        size="icon-sm"
        variant="ghost"
        on:click={props.handleCancel}
      >
        <XIcon />
      </Button>

      <SendButton
        tooltip="Send Comment"
        shortcut="enter"
        disabled={!props.hasContent || props.isSending}
        pending={props.isSending}
        onPointerDown={(event) => {
          event.preventDefault();
          props.handleSend();
        }}
      />
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
    <div
      class={cn('p-2 pb-8')}
      on:click={(e) => {
        e.stopPropagation();
        focusEditor();
      }}
    >
      <MarkdownTextarea
        autoLinkMatchMode="common-tlds"
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
    <div class="flex w-full flex-col mt-2">
      <div class="h-px bg-edge-muted w-[calc(100%+1rem)] -mx-2"></div>
      <Show
        when={props.isEditing}
        fallback={
          <div
            class="cursor-default p-2 text-sm text-ink-placeholder"
            on:click={(e) => {
              e.stopPropagation();
              props.setEditing(true);
            }}
          >
            <p class="mt-1.5">Reply...</p>
          </div>
        }
      >
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
