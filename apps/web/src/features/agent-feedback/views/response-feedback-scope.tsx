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

export function ResponseFeedbackScope(props: {
  controller: Accessor<ResponseFeedbackController | undefined>;
  children: JSX.Element;
}) {
  return (
    <ResponseFeedbackProvider value={props.controller}>
      {props.children}
      <Show when={props.controller()}>
        {(controller) => (
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
        )}
      </Show>
    </ResponseFeedbackProvider>
  );
}
