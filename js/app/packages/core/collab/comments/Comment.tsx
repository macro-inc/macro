import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useAuthor } from '@service-gql/client';
import {
  createEffect,
  createMemo,
  createSignal,
  type ParentProps,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import type { Root } from './commentType';
import { EditInput } from './Inputs';
import { MessageTopRow } from './MessageTopRow';
import { CommentsContext, sendMentions, ThreadContext } from './Thread';

const ThreadLine = () => {
  return (
    <div class="w-[1px] bg-edge/50 h-full absolute left-3 -translate-x-[0.5px] top-4" />
  );
};

const CommentText = (props: { text: string; isThreaded?: boolean }) => {
  return (
    <div class="ml-6 pb-2">
      <StaticMarkdown markdown={props.text} />
    </div>
  );
};

function CommentContainer(props: ParentProps<{ isThreaded?: boolean }>) {
  return (
    <div class="relative isolate group">
      <div class="absolute -top-0 -left-0 size-[calc(100%)] bracket bg-menu/30 -z-1 transition-opacity duration-50 opacity-0 group-hover:opacity-100" />
      <div
        class="supports-[text-pretty]:whitespace-normal break-words p-1"
        classList={{
          'pb-2': props.isThreaded,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export function Comment(
  props: ParentProps<{
    comment: Root;
    isOwned: boolean;
    isActive: boolean;
    isThreaded?: boolean;
  }>
) {
  const { commentOperations, setActiveThread } = useContext(CommentsContext);

  const isResolved = createMemo(() => props.comment.resolved ?? false);
  const date = createMemo(() => new Date(props.comment.createdAt));

  const [textValue, setTextValue] = createSignal<string>(props.comment.text);
  const [isEditing, setIsEditing] = createSignal<boolean>(false);

  createEffect(() => {
    if (!untrack(isEditing)) return;
    if (!props.isActive) {
      setIsEditing(false);
    }
  });

  const mentionsSignal = useContext(ThreadContext).mentionsSignal;

  return (
    <Show
      when={isEditing()}
      fallback={
        <CommentContainer isThreaded={props.isThreaded}>
          <Show when={props.isThreaded}>
            <ThreadLine />
          </Show>
          <MessageTopRow
            isOwned={props.isOwned}
            isActive={props.isActive}
            authorId={props.comment.author}
            date={date()}
            isNew={false}
            isResolved={isResolved()}
            toggleResolve={undefined} // Hide resolve button
            deleteMessage={() =>
              commentOperations.deleteComment({
                commentId: props.comment.id,
              })
            }
            enableEditing={() => {
              // prevent unsetting editing state by setting active comment thread first
              setActiveThread(props.comment.threadId);
              setIsEditing(true);
            }}
          />
          <CommentText text={props.comment.text} />
          {props.children}
        </CommentContainer>
      }
    >
      <CommentContainer isThreaded={props.isThreaded}>
        <MessageTopRow
          isOwned={props.isOwned}
          isActive={props.isActive}
          isEditing
          authorId={props.comment.author}
          date={date()}
          isResolved={false}
          isNew={false}
          hideBottomMargin
        />
      </CommentContainer>
      <EditInput
        onSend={(newText: string) => {
          if (newText.trim() === '') return;
          setIsEditing(false);
          setTextValue(newText);
          Promise.all([
            commentOperations.updateComment({
              text: newText,
              commentId: props.comment.id,
            }),
            sendMentions(
              {
                type: 'edit-comment',
                commentId: props.comment.id,
                threadId: props.comment.threadId,
                text: newText,
              },
              mentionsSignal
            ),
          ]);
        }}
        handleCancel={() => {
          setTextValue(textValue());
        }}
        setEditing={setIsEditing}
        textValue={textValue()}
      />
      {/*tiny spacer*/}
      <div class="w-full h-2" />
    </Show>
  );
}

export function CommentReply(
  props: ParentProps<{
    hide?: boolean;
    replyId: number;
    threadId: number;
    deleteReply: () => void;
    updateReply: (content: string) => void;
    isOwned: boolean;
    isActive: boolean;
    isThreaded?: boolean;
  }>
) {
  const thisAuthor = useAuthor();
  const { getCommentById } = useContext(CommentsContext);
  const reply = createMemo(() => getCommentById(props.replyId));

  const [isEditing, setIsEditing] = createSignal<boolean>(false);
  const [textValue, setTextValue] = createSignal<string>('');

  createEffect(() => setTextValue(reply()?.text ?? ''));

  const authorId = createMemo(() => reply()?.author ?? thisAuthor() ?? '');
  const date = createMemo(() => new Date(reply()?.createdAt ?? ''));
  const isNew = createMemo(() => reply()?.isNew ?? true);

  return (
    <Show when={!props.hide && reply()}>
      <Show
        when={isEditing()}
        fallback={
          <CommentContainer isThreaded={props.isThreaded}>
            <Show when={props.isThreaded}>
              <ThreadLine />
            </Show>
            <MessageTopRow
              authorId={authorId()}
              date={date()}
              isNew={isNew()}
              isResolved={false}
              deleteMessage={props.deleteReply}
              enableEditing={() => setIsEditing(true)}
              hideBottomMargin
              isOwned={props.isOwned}
              isActive={props.isActive}
            />
            <CommentText text={reply()?.text ?? ''} />
            {props.children}
          </CommentContainer>
        }
      >
        <CommentContainer isThreaded={props.isThreaded}>
          <MessageTopRow
            authorId={authorId()}
            date={date()}
            isNew={isNew()}
            isResolved={false}
            isEditing
            isOwned={props.isOwned}
            isActive={props.isActive}
          />
          <EditInput
            handleCancel={() => {
              setIsEditing(false);
              setTextValue(textValue);
            }}
            onSend={(newText: string) => {
              if (newText.trim() === '') return;
              props.updateReply(newText);
              setIsEditing(false);
              setTextValue(newText);
            }}
            hidePadding
            isReply
            setEditing={setIsEditing}
            textValue={textValue()}
          />
          {/*tiny spacer*/}
          <div class="w-full h-1" />
        </CommentContainer>
      </Show>
    </Show>
  );
}
