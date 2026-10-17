import { Show } from 'solid-js';
import { EmailThreadReply } from '../email-thread/email-thread-reply';
import type { ReplyWindowState } from './primitives/reply-window-state';
import { ReplyWindowFrame } from './views/reply-window-frame';

/** The reply window's contents; loaded the first time a reply pops out. */
export function ReplyWindowView(props: { state: ReplyWindowState }) {
  const { state } = props;
  return (
    // A different reply is a different composer.
    <Show when={state.reply()} keyed>
      {(reply) => (
        <EmailThreadReply
          reply={reply}
          onGiveBack={state.giveBack}
          onFinished={state.finish}
          registerMove={state.registerMove}
          frame={(title, body) => (
            <ReplyWindowFrame
              title={title()}
              minimized={state.minimized()}
              expanded={state.expanded()}
              focusRequest={state.focusRequest()}
              onMinimizedChange={state.setMinimized}
              onExpandedChange={state.setExpanded}
              onClose={() => void state.requestClose()}
            >
              {body}
            </ReplyWindowFrame>
          )}
        />
      )}
    </Show>
  );
}
