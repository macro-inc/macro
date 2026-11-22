/**
 * Hands a response's feedback controller to the controls inside it, and owns
 * the note dialog, so the dialog outlives the control that opened it (a
 * hover toolbar, a sheet that closes as it opens the note).
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, type JSX, Show } from 'solid-js';
import { FeedbackNoteDialog } from '../components/feedback-note-dialog';
import {
  type ResponseFeedbackController,
  ResponseFeedbackProvider,
} from '../context/response-feedback-context';

function stopPropagation(event: Event) {
  event.stopPropagation();
}

export function ResponseFeedbackScope(props: {
  controller: Accessor<ResponseFeedbackController | undefined>;
  children: JSX.Element;
}) {
  return (
    <ResponseFeedbackProvider value={props.controller}>
      {props.children}
      <Show when={props.controller()}>
        {(controller) => (
          // The dialog is portaled, but Solid still bubbles its events to the
          // JSX parent: a click in it must not select the message row.
          <div
            class="contents"
            onClick={stopPropagation}
            onKeyDown={stopPropagation}
            onPointerDown={stopPropagation}
            onMouseDown={stopPropagation}
            onFocusIn={stopPropagation}
            onFocusOut={stopPropagation}
          >
            <Show when={controller().noteDraft()}>
              {(draft) => (
                <FeedbackNoteDialog
                  open
                  rating={draft().rating}
                  initialNote={draft().note}
                  onSave={(note) =>
                    fireAndForget(controller().saveNote(note), 'agent-feedback')
                  }
                  onSkip={() => controller().closeNote()}
                />
              )}
            </Show>
          </div>
        )}
      </Show>
    </ResponseFeedbackProvider>
  );
}
