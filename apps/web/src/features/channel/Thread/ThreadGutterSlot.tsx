import type { Accessor, JSX, ParentProps } from 'solid-js';

/**
 * Controls the host puts in the channel's gutter, left of the message column:
 * beside the thread's top-level message, and beside a reply on screen. The
 * top-level message's controls receive the replies on screen, so a control
 * for a hidden reply can sit there instead.
 */
export type ThreadGutter = {
  root: (shownReplyIds: Accessor<readonly string[]>) => JSX.Element;
  reply: (replyId: string) => JSX.Element;
};

/**
 * Places its children in the gutter left of the message column, level with
 * the message's avatar (or first line, for a grouped message). It shows only
 * while the pane leaves 44px of gutter: a 28px control and 12px from the
 * 920px column on each side (`@container/channel-pane`, 1008px wide). Replies
 * are indented by `--thread-gutter-inset`, which their container sets, so
 * every control shares one lane.
 */
export function ThreadGutterSlot(props: ParentProps<{ grouped?: boolean }>) {
  return (
    <div
      data-thread-gutter
      class="absolute z-1 hidden flex-col gap-1 @min-[1008px]/channel-pane:flex"
      style={{
        right: 'calc(100% + 12px + var(--thread-gutter-inset, 0px))',
        top: props.grouped
          ? '-2px'
          : 'calc(var(--regular-message-padding-t) + 2px)',
      }}
    >
      {props.children}
    </div>
  );
}
