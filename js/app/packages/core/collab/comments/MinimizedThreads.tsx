import { BozzyBracketInnerSibling } from '@core/component/BozzyBracket';
import ChatTeardrop from '@icon/regular/chat-teardrop.svg';
import type { EditorThemeClasses } from 'lexical';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { Layout, Root } from './commentType';
import { MeasureContainer } from './MeasureContainer';
import { Thread } from './Thread';

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
        transition={true}
      >
        <div
          class="flex flex-row p-[2px] w-full gap-1 transition-transform items-center bg-panel text-ink-muted border-edge/50 border-1 relative overflow-clip"
          classList={{
            '-translate-x-4': props.isActive,
          }}
          onClick={clickHandler}
        >
          <div
            class="size-6 flex items-center justify-center"
            classList={{
              'bg-comment-bg text-comment-fg': !props.isActive,
              'bg-comment text-page': props.isActive,
            }}
          >
            <ChatTeardrop
              class="size-5 pointer-events-auto"
              onClick={clickHandler}
            />
          </div>
          <div class="flex items-center px-1 h-6 pointer-events-auto">
            <span class="text-xs font-bold text-center font-mono whitespace-pre">
              [ {commentCount()} ]
            </span>
          </div>
          <BozzyBracketInnerSibling
            classList={{
              'opacity-0': !props.isActive,
              'transition-transform duration-100': true,
              'scale-110': !props.isActive,
              'scale-100': props.isActive,
            }}
          />
        </div>
      </MeasureContainer>
    </Show>
  );
}
