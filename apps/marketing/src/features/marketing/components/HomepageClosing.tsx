import { useLocation } from '@solidjs/router';
import { Show } from 'solid-js';
import { FeatureGuide } from '../../documentation/components/FeatureGuide';
import { FEATURE_PAGES } from '../core/navigation';
import { FeaturePageCta } from './FeaturePage';
import { HomepageReassurance } from './HomepageReassurance';
import './workspace-story.css';

/** Static signup ending for product and marketing pages. */
export function HomepageClosing() {
  const location = useLocation();
  const feature = () =>
    FEATURE_PAGES.find(
      (page) => page.href === location.pathname.replace(/\/$/, '')
    );
  return (
    <>
      <Show when={feature()}>
        {(page) => <FeatureGuide slug={page().guide.slice(6)} />}
      </Show>
      <footer class="homepage-feature-end workspace-demo">
        <hr class="homepage-closing-rule" />
        <div class="homepage-closing-signup">
          <FeaturePageCta name="page_bottom_signup" label="Sign Up" />
        </div>
        <HomepageReassurance />
      </footer>
    </>
  );
}
