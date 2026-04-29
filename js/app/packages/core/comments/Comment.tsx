import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useAuthor } from '@core/context/user';
import {
  createEffect,
  createMemo,
  createSignal,
  type ParentProps,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import { getAndClearCommentMentions } from '.';
import type { Root } from './commentType';
import { EditInput } from './Inputs';
import { MessageTopRow } from './MessageTopRow';
import { CommentsContext, ThreadContext } from './Thread';
import { useMaybeBlockAliasedName } from '@core/block';
import { buildSimpleEntityUrl } from '@core/util/url';
import { URL_PARAMS as MD_URL_PARAMS } from '@block-md/constants';
import { toast } from '@core/component/Toast/Toast';

const ThreadLine = () => {
  return (
    <div class="w-px bg-edge/50 h-full absolute left-3 translate-x-[-0.5px] top-4" />
  );
};

const CommentText = (props: { text: string; isThreaded?: boolean }) => {
  return (
    <div class="ml-6 pb-2">
      <StaticMarkdown markdown={props.text} />
    </div>
  );
};

function CommentContainer(
  props: ParentProps<{ isThreaded?: boolean; isHighlighted?: boolean }>
) {
  return (
    <div
      class="relative isolate group rounded-sm"
      classList={{
        'outline-1 outline-accent/20 -outline-offset-1': props.isHighlighted,
      }}
    >
      <div
        class="absolute top-0 left-0 size-[calc(100%)] rounded-sm -z-1"
        classList={{
          'bg-accent/5 opacity-100': props.isHighlighted,
          'bg-hover opacity-0 group-hover:opacity-100': !props.isHighlighted,
        }}
      />
      <div
        class="supports-text-pretty:whitespace-normal wrap-break-word p-1"
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
  const maybeBlockName = useMaybeBlockAliasedName();
  const commentsContext = useContext(CommentsContext);

  const { commentOperations, setActiveThread, highlightedCommentId } =
    commentsContext;
  const isHighlighted = createMemo(
    () => highlightedCommentId() === props.comment.id
  );

  const isResolved = createMemo(() => props.comment.resolved ?? false);
  const date = () => props.comment.createdAt;

  const [textValue, setTextValue] = createSignal<string>(props.comment.text);
  const [isEditing, setIsEditing] = createSignal<boolean>(false);

  createEffect(() => {
    if (!untrack(isEditing)) return;
    if (!props.isActive) {
      setIsEditing(false);
    }
  });

  const copyLink = () => {
    if (!maybeBlockName) return;
    return async () => {
      const params: Record<string, string> = {};
      if (maybeBlockName === 'task' || maybeBlockName === 'md') {
        params[MD_URL_PARAMS.commentId] = props.comment.id.toString();
      }
      try {
        const url = buildSimpleEntityUrl(
          { type: maybeBlockName, id: commentsContext.documentId },
          params
        );
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
      } catch (_) {
        toast.failure('Could not copy link');
      }
    };
  };

  const mentionsSignal = useContext(ThreadContext).mentionsSignal;

  return (
    <Show
      when={isEditing()}
      fallback={
        <CommentContainer
          isThreaded={props.isThreaded}
          isHighlighted={isHighlighted()}
        >
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
            copyLink={copyLink()}
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
            commentOperations.updateComment(props.comment.id, {
              text: newText,
              threadId: props.comment.threadId,
              mentions: getAndClearCommentMentions(mentionsSignal),
            }),
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
  const { getCommentById, highlightedCommentId, documentId } =
    useContext(CommentsContext);
  const maybeBlockName = useMaybeBlockAliasedName();
  const reply = createMemo(() => getCommentById(props.replyId));
  const isHighlighted = createMemo(
    () => highlightedCommentId() === props.replyId
  );

  const copyLink = () => {
    if (!maybeBlockName) return;
    return async () => {
      const params: Record<string, string> = {};
      if (maybeBlockName === 'task' || maybeBlockName === 'md') {
        params[MD_URL_PARAMS.commentId] = props.replyId.toString();
      }
      try {
        const url = buildSimpleEntityUrl(
          { type: maybeBlockName, id: documentId },
          params
        );
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
      } catch (_) {
        toast.failure('Could not copy link');
      }
    };
  };

  const [isEditing, setIsEditing] = createSignal<boolean>(false);
  const [textValue, setTextValue] = createSignal<string>('');

  createEffect(() => setTextValue(reply()?.text ?? ''));

  const authorId = createMemo(() => reply()?.author ?? thisAuthor() ?? '');
  const date = () => reply()?.createdAt;
  const isNew = createMemo(() => reply()?.isNew ?? true);

  return (
    <Show when={!props.hide && reply()}>
      <Show
        when={isEditing()}
        fallback={
          <CommentContainer
            isThreaded={props.isThreaded}
            isHighlighted={isHighlighted()}
          >
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
              copyLink={copyLink()}
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
