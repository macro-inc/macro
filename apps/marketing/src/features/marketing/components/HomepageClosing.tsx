import { useLocation } from '@solidjs/router';
import { onCleanup, onMount, Show } from 'solid-js';
import { FeatureGuide } from '../../documentation/components/FeatureGuide';
import { FEATURE_PAGES } from '../core/navigation';
import { animateHomepageCta } from './animateHomepageCta';
import { HomepageReassurance } from './HomepageReassurance';
import './workspace-story.css';

/** The header's app button lands here as the visitor reaches the footer. */
export function HomepageClosing(props: { root?: () => HTMLElement } = {}) {
  const location = useLocation();
  const feature = () =>
    FEATURE_PAGES.find(
      (page) => page.href === location.pathname.replace(/\/$/, '')
    );
  let footer!: HTMLElement;
  let destination!: HTMLDivElement;
  onMount(() => {
    onCleanup(
      animateHomepageCta(props.root?.() ?? footer.parentElement!, destination)
    );
  });
  return (
    <>
      <Show when={feature()}>
        {(page) => <FeatureGuide slug={page().guide.slice(6)} />}
      </Show>
      <footer ref={footer} class="homepage-feature-end workspace-demo">
        <hr class="homepage-closing-rule" />
        <div
          ref={destination}
          class="homepage-app-landing"
          aria-hidden="true"
        />
        <HomepageReassurance />
      </footer>
    </>
  );
}
