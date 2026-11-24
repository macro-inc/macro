import type { TutorialVideoId } from '../../core/tutorial-videos';
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
}) {
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
    </figure>
  );
}
