/**
 * The app-facing entry: a feedback scope over one agent response. With the
 * flag off or still loading, or without a subject (not an agent's response),
 * it creates nothing and fetches nothing; the controls inside render nothing.
 */
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableAgentResponseFeedback } from '@core/constant/featureFlags';
import { deepEqual } from '@core/util/compareUtils';
import { createMemo, type JSX, untrack } from 'solid-js';
import type { FeedbackSubject, FeedbackSurface } from './core/subject';
import { createResponseFeedback } from './primitives/create-response-feedback';
import { agentFeedbackClient } from './queries/client';
import { createResponseFeedbackSource } from './queries/feedback';
import { ResponseFeedbackButtons } from './views/response-feedback-buttons';
import { ResponseFeedbackScope } from './views/response-feedback-scope';

export function AgentFeedbackScope(props: {
  /** Undefined when the response can't be rated. */
  subject: FeedbackSubject | undefined;
  surface: FeedbackSurface;
  children: JSX.Element;
}) {
  const flag = useFeatureFlag(enableAgentResponseFeedback);
  const target = createMemo(
    () => {
      const subject = props.subject;
      if (!flag().enabled || !subject) return undefined;
      return { subject, surface: props.surface };
    },
    undefined,
    { equals: deepEqual }
  );
  // One controller per response, owned by this memo: a new subject disposes
  // the old one's read and write observers.
  const controller = createMemo(() => {
    const current = target();
    if (!current) return undefined;
    return untrack(() =>
      createResponseFeedback(
        createResponseFeedbackSource(
          agentFeedbackClient,
          current.subject,
          current.surface
        ),
        () => toast.failure(t('agentFeedback.saveFailed'))
      )
    );
  });

  return (
    <ResponseFeedbackScope controller={controller}>
      {props.children}
    </ResponseFeedbackScope>
  );
}

/** Inline thumbs for one response: under an agent reply, on a routine run. */
export function ResponseFeedback(props: {
  subject: FeedbackSubject | undefined;
  surface: FeedbackSurface;
  class?: string;
}) {
  return (
    <AgentFeedbackScope subject={props.subject} surface={props.surface}>
      <ResponseFeedbackButtons class={props.class} />
    </AgentFeedbackScope>
  );
}
