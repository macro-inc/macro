import { FeatureUiStyles } from './FeaturePage';
import { HomepageClosing } from './HomepageClosing';

/** The shared feature-page ending for legacy article and information layouts. */
export function SitePageClosing() {
  let wrapper!: HTMLDivElement;
  return (
    <div ref={wrapper} class="feature-page" data-product-spacing="true">
      <FeatureUiStyles />
      <HomepageClosing
        root={() =>
          wrapper.closest<HTMLElement>('.marketing-content') ?? wrapper
        }
      />
    </div>
  );
}
