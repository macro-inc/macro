import { ResponseFeedback } from '@app/features/agent-feedback/agent-feedback';
import type { FeedbackSurface } from '@app/features/agent-feedback/core/subject';

/**
 * Thumbs for one suggestion, which a session wrote for the person. Renders
 * nothing while agent response feedback is off for them.
 */
export function SuggestionFeedback(props: {
  suggestionId: string;
  surface: Extract<
    FeedbackSurface,
    'suggestion_row' | 'suggestion_tile' | 'suggestion_draft'
  >;
}) {
  return (
    <ResponseFeedback
      subject={{ kind: 'suggestion', suggestionId: props.suggestionId }}
      surface={props.surface}
    />
  );
}
