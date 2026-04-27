import {
  activeCommentThreadSignal,
  noScrollToActiveCommentThreadSignal,
  useIsActiveThreadSelector,
} from '@block-pdf/store/comments/commentStore';
import type { IThreadPlaceable } from '@block-pdf/type/placeables';
import { cn } from '@ui/utils/classname';
import type { Component } from 'solid-js';

export const FreeCommentPlaceable: Component<{
  payload: NonNullable<IThreadPlaceable['payload']>;
}> = (props) => {
  const isActiveThreadSelector = useIsActiveThreadSelector();
  const setActiveThreadId = activeCommentThreadSignal.set;

  return (
    <CommentIndicator
      threadId={props.payload.threadId}
      isActive={isActiveThreadSelector(props.payload.threadId)}
      setActive={() => setActiveThreadId(props.payload.threadId)}
      numComments={props.payload.comments.length}
    />
  );
};

export const NewFreeCommentPlaceable: Component = () => {
  return <CommentIndicator threadId={-1} isActive={true} numComments={1} />;
};

function CommentIndicator(props: {
  threadId: number;
  numComments: number;
  isActive: boolean;
  setActive?: () => void;
}) {
  const setNoScrollToActiveCommentThread =
    noScrollToActiveCommentThreadSignal.set;

  // SCUFFED, decide how to define this color
  return (
    <div
      class={cn(
        'absolute h-full w-full rounded-full flex items-center justify-center',
        props.isActive
          ? 'bg-[oklch(0.785_0.115_274.713)] text-[oklch(0.398_0.195_277.366)]'
          : 'bg-[oklch(0.93_0.034_272.788)] text-[oklch(0.585_0.233_277.117)] hover:bg-[oklch(0.87_0.065_274.039)] hover:text-[oklch(0.511_0.262_276.966)]'
      )}
      on:mousedown={() => {
        setNoScrollToActiveCommentThread(true);
        props.setActive?.();
      }}
      on:mouseup={() => {
        setNoScrollToActiveCommentThread(false);
      }}
    >
      {props.numComments > 1 && !props.isActive && (
        <div class="w-2.5 h-2.5 absolute top-[-3.5px] right-[-3.5px] bg-[oklch(0.785_0.115_274.713)] text-[oklch(0.457_0.24_277.023)] flex items-center justify-center rounded-full text-[6px]">
          {props.numComments}
        </div>
      )}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        class="w-3 h-3"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
        />
      </svg>
    </div>
  );
}
