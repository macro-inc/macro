import ArrowRight from '@icon/system/regular/arrow-right.svg';
import { Show } from 'solid-js';
import type { TutorialVideoId } from '../../core/tutorial-videos';
import { TutorialVideoDialog } from '../TutorialVideoDialog';
import { TutorialWallpaper } from '../TutorialWallpaper';
import './homepage-screen.css';

/**
 * A captured app window on its product's wallpaper. `bleed` lets the window
 * run off the right and bottom edges; `full` keeps the whole window in view.
 */
export function HomepageScreen(props: {
  tutorial: TutorialVideoId;
  src: string;
  alt: string;
  fit?: 'bleed' | 'full';
  page?: { title: string; path: string };
}) {
  const pageLabel = () => {
    if (!props.page) return '';
    return props.page.title === 'CRM'
      ? props.page.title
      : props.page.title.toLowerCase();
  };

  return (
    <figure class="homepage-screen" data-fit={props.fit ?? 'bleed'}>
      <div class="homepage-screen-wallpaper" aria-hidden="true">
        <TutorialWallpaper tutorial={props.tutorial} />
      </div>
      <img
        class="homepage-screen-window"
        src={props.src}
        alt={props.alt}
        width="1700"
        height="916"
        loading="lazy"
        decoding="async"
      />
      <div class="homepage-screen-actions">
        <TutorialVideoDialog
          tutorial={props.tutorial}
          triggerClass="homepage-screen-action homepage-screen-action--video"
          lengthClass="homepage-screen-action-length"
          triggerLabel="Watch"
          autoPlay
        />
        <Show when={props.page}>
          {(page) => (
            <a
              class="homepage-screen-action homepage-screen-action--page"
              href={page().path}
            >
              <span>Learn about {pageLabel()}</span>
              <ArrowRight aria-hidden="true" />
            </a>
          )}
        </Show>
      </div>
    </figure>
  );
}
