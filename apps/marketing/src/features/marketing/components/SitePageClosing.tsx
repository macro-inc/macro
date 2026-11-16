import { FeatureUiStyles } from './FeaturePage';
import { HomepageClosing } from './HomepageClosing';

/** Static signup ending for article and marketing layouts. */
export function SitePageClosing() {
  return (
    <div class="feature-page" data-product-spacing="true">
      <FeatureUiStyles />
      <HomepageClosing />
    </div>
  );
}
