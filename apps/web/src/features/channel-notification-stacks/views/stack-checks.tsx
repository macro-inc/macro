import type { ThreadGutter } from '@channel/Thread/ThreadGutterSlot';
import { type Accessor, Index } from 'solid-js';
import { StackDoneCheck } from '../components/stack-done-check';
import { type SenderName, stackLabel } from '../components/stack-label';
import type { ChannelStack, ThreadStacks } from '../core/channel-stacks';

function StackChecks(props: {
  stacks: readonly ChannelStack[];
  senderName: SenderName;
  onDone: (stack: ChannelStack) => void;
}) {
  return (
    <Index each={props.stacks}>
      {(stack) => (
        <StackDoneCheck
          label={stackLabel(stack(), props.senderName)}
          onDone={() => props.onDone(stack())}
        />
      )}
    </Index>
  );
}

/**
 * The checks a thread puts in the gutter: a top-level stack's beside its
 * message, a thread stack's beside its newest reply, or beside the top-level
 * message while that reply is not on screen (a collapsed thread).
 */
export function stackChecksGutter(options: {
  stacks: Accessor<ThreadStacks | undefined>;
  senderName: SenderName;
  onDone: (stack: ChannelStack) => void;
}): ThreadGutter {
  return {
    root: (shownReplyIds) => {
      const stacks = () => {
        const entry = options.stacks();
        if (!entry) return [];
        const shown = new Set(shownReplyIds());
        const hiddenReplies = [...entry.replies]
          .filter(([replyId]) => !shown.has(replyId))
          .flatMap(([, stacks]) => stacks);
        return [...entry.root, ...hiddenReplies];
      };
      return (
        <StackChecks
          stacks={stacks()}
          senderName={options.senderName}
          onDone={options.onDone}
        />
      );
    },
    reply: (replyId) => (
      <StackChecks
        stacks={options.stacks()?.replies.get(replyId) ?? []}
        senderName={options.senderName}
        onDone={options.onDone}
      />
    ),
  };
}
