import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import { cn, Layer } from '@ui';
import type { EditorThemeClasses } from 'lexical';
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import type { Layout, Root } from './commentType';
import { MeasureContainer } from './MeasureContainer';
import { CommentsContext, Thread } from './Thread';

export function MinimizedThread(props: {
  comment: Root;
  layout: Layout;
  isActive: boolean;
  theme?: EditorThemeClasses;
  maxHeight?: number;
}) {
  const [expanded, setExpanded] = createSignal<boolean>(false);
  const [expandedThreadRef, setExpandedThreadRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  if (props.comment.isNew) {
    setExpanded(true);
  }

  const { highlightedCommentId } = useContext(CommentsContext);
  createEffect(() => {
    const hId = highlightedCommentId();
    if (hId === null) return;
    if (hId === props.comment.id || props.comment.children.includes(hId)) {
      setExpanded(true);
    }
  });

  createEffect(() => {
    if (!expanded()) return;
    function handleClick(e: MouseEvent) {
      const _expandedThreadRef = expandedThreadRef();
      if (
        _expandedThreadRef &&
        !_expandedThreadRef.contains(e.target as Node)
      ) {
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClick);
    });
  });

  // TODO (seamus) : in the current version of minimized threads the ids are
  // not being shown.
  // const _userIds = createMemo(() => {
  //   const ids = new Set<string>();
  //   ids.add(props.comment.author);
  //   for (const replyId of props.comment.children) {
  //     const reply = getCommentById(replyId) as Reply | undefined;
  //     if (reply && reply.author) ids.add(reply.author);
  //   }
  //   return Array.from(ids);
  // });

  const commentCount = () => 1 + props.comment.children.length;
  const clickHandler = () => {
    setExpanded(true);
  };

  return (
    <Show
      when={!expanded()}
      fallback={
        <Thread
          comment={props.comment}
          layout={props.layout}
          isActive={true}
          maxHeight={props.maxHeight}
          ref={setExpandedThreadRef}
          width={320}
        />
      }
    >
      <MeasureContainer
        alignment={'left'}
        alignmentOffset={0}
        top={props.layout.calculatedYPos}
        threadId={props.comment.threadId}
        maxHeight={props.maxHeight}
        isActive={props.isActive}
        transition={false}
      >
        <Layer depth={2}>
          <div
            class={cn(
              'transition-transform flex items-center group text-ink-extra-muted pointer-events-auto',
              props.isActive && '-translate-x-4'
            )}
            onClick={clickHandler}
          >
            <div
              class={cn('inline-flex items-center gap-1 px-1 rounded-lg', {
                'group-hover:bg-hover': !props.isActive,
                'bg-comment/10 group-hover:bg-comment/20': props.isActive,
              })}
            >
              <ChatTeardrop class="size-4" onClick={clickHandler} />
              <div class="flex items-center px-1 h-6">
                <span class="text-xs text-center">{commentCount()}</span>
              </div>
            </div>
          </div>
        </Layer>
      </MeasureContainer>
    </Show>
  );
}
