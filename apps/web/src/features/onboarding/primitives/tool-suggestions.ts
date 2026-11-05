import type { OnboardingContext } from '../context/onboarding-context';
import {
  ONBOARDING_SENDER_DOMAINS,
  rankSuggestedTools,
  type SuggestedTool,
} from '../core/tools';

/**
 * The tools to suggest, ranked by the viewer's inbox; undefined while the
 * inbox is checked. A failed check suggests the defaults instead.
 */
export function createToolSuggestions(
  context: Pick<OnboardingContext, 'createSenderDomainCounts'>
): () => SuggestedTool[] | undefined {
  const counts = context.createSenderDomainCounts(ONBOARDING_SENDER_DOMAINS);
  return () => {
    const loaded = counts();
    if (loaded.t === 'loading') return undefined;
    return rankSuggestedTools(loaded.t === 'ready' ? loaded.value : {});
  };
}
