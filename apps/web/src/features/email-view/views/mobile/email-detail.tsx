import type { EmailBlockViewProps } from '@block-email/EmailThreadHostView';
import {
  MobileEmailThread,
  type MobileEmailThreadList,
} from '@block-email/views/mobile/email-thread';
import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import type { JSX } from 'solid-js';

/**
 * A thread in touch Mail: the thread's own mobile header, as a standalone
 * thread has, in the pane's top bar. The workspace adds Back while the thread
 * covers the list.
 */
export function MobileEmailDetail(
  props: EmailBlockViewProps & {
    list: MobileEmailThreadList;
    /** Wraps the thread in the entry's load gate and focus target. */
    frame: (thread: () => JSX.Element) => JSX.Element;
  }
) {
  return (
    <SplitHeaderScope.Root>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <SplitHeaderScope.TopBar />
        {props.frame(() => (
          <MobileEmailThread
            title={props.title}
            threadId={props.threadId}
            source={props.source}
            host={props.host}
            list={props.list}
          />
        ))}
      </div>
    </SplitHeaderScope.Root>
  );
}
