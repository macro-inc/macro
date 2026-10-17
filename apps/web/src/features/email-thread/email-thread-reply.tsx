import { displaySubject } from '@app/features/email-compose/core/subject-text';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useThreadQuery } from '@queries/email/thread';
import { representativeThreadMessage } from '@queries/email/thread-subject';
import type { Accessor, JSX } from 'solid-js';
import type { ReplyType } from '../email-compose/core/reply-type';
import type { EmailReplyHandoff } from './context/email-thread-view-context';
import { createEmailThreadComposition } from './email-thread';
import { createEmailThreadSource } from './queries/thread-source';
import { EmailThreadReplySurface } from './views/email-thread-reply';

/** App-facing composition of a thread's reply on its own, for the reply window. */
export function EmailThreadReply(props: {
  reply: EmailReplyHandoff;
  /** The window around the reply, given the thread's subject. */
  frame: (title: Accessor<string>, reply: JSX.Element) => JSX.Element;
  onGiveBack: (replyType: ReplyType) => void;
  onFinished: () => void;
  registerMove: (move: () => Promise<void>) => () => void;
}) {
  const threadId = () => props.reply.threadId;
  const threadQuery = useThreadQuery(threadId, () => ({ enabled: true }));
  const source = createEmailThreadSource(threadId, threadQuery);
  const { replaceSplit } = useSplitLayout();
  const { viewContext, rendering } = createEmailThreadComposition({
    threadId,
    source,
    threadTransport: () => threadQuery.transport,
    // Outside any split, a reply that lands in another thread opens there.
    composeHost: {
      showThread: (id) =>
        replaceSplit({ content: { type: 'email', id }, mergeHistory: true }),
    },
  });
  const title = () => {
    const thread = source.thread();
    return (
      (thread &&
        displaySubject(
          representativeThreadMessage(thread.messages)?.subject
        )) ||
      'Reply'
    );
  };

  return props.frame(
    title,
    <EmailThreadReplySurface
      context={viewContext}
      emailRendering={rendering}
      reply={props.reply}
      onGiveBack={props.onGiveBack}
      onFinished={props.onFinished}
      registerMove={props.registerMove}
    />
  );
}
