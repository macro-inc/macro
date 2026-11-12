import { FeatureConstellation } from '../../setup/components/FeatureOverview';
import './homepage-feature-links.css';

/** Compact feature links above the homepage introduction. */
export function HomepageFeatureLinks() {
  return (
    <section class="homepage-feature-links" aria-label="Explore Macro features">
      <FeatureConstellation expanded linked />
    </section>
  );
}
