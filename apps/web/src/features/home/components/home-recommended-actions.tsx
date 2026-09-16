import { HomeSectionBoundary } from '../home-section-boundary';
import { useHomeRecommendations } from '../use-home-recommendations';
import { HomeSuggestions } from './home-suggestions';

function RecommendedActions() {
  const recommendations = useHomeRecommendations();
  return (
    <HomeSuggestions
      view={recommendations.view()}
      onSelect={recommendations.selectRecommendation}
      onOpen={(item) => void recommendations.openRecommendation(item)}
      onRetry={recommendations.retry}
      onConnect={() => recommendations.openSettings('Email')}
    />
  );
}

/** Keep recommendation loading and errors isolated from the composer. */
export function HomeRecommendedActions() {
  return (
    <HomeSectionBoundary title="suggestions" fallback={null}>
      <RecommendedActions />
    </HomeSectionBoundary>
  );
}
