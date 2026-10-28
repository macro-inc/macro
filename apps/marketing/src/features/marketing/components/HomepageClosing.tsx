import { onCleanup, onMount } from 'solid-js';
import { animateHomepageCta } from './animateHomepageCta';
import { HomepageReassurance } from './HomepageReassurance';
import './workspace-story.css';

/** The header's app button lands here as the visitor reaches the footer. */
export function HomepageClosing(props: { root?: () => HTMLElement } = {}) {
  let footer!: HTMLElement;
  let destination!: HTMLDivElement;
  onMount(() => {
    onCleanup(
      animateHomepageCta(props.root?.() ?? footer.parentElement!, destination)
    );
  });
  return (
    <footer ref={footer} class="homepage-feature-end workspace-demo">
      <hr class="homepage-closing-rule" />
      <div ref={destination} class="homepage-app-landing" aria-hidden="true" />
      <HomepageReassurance />
    </footer>
  );
}
