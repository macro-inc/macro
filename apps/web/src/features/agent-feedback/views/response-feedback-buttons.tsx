/** The inline thumbs under an agent reply or a routine run, within a feedback scope. */
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { FeedbackButtons } from '../components/feedback-buttons';
import { useResponseFeedback } from '../context/response-feedback-context';

export function ResponseFeedbackButtons(props: { class?: string }) {
  const feedback = useResponseFeedback();

  return (
    <Show when={feedback()?.ready() && feedback()}>
      {(controller) => (
        <FeedbackButtons
          class={props.class}
          rating={controller().rating()}
          hasNote={controller().note() !== null}
          onRate={(rating) =>
            fireAndForget(controller().rate(rating), 'agent-feedback')
          }
          onNote={() => controller().openNote()}
        />
      )}
    </Show>
  );
}
