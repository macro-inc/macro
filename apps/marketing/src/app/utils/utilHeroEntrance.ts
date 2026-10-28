import { onCleanup, onMount } from 'solid-js';
import { isServer } from 'solid-js/web';
import './utilHeroEntrance.css';

type HeroPart = 'title' | 'copy' | 'actions' | 'preview' | 'backdrop';
const disabledMotionQuery =
  '(max-width: 699px), (prefers-reduced-motion: reduce)';
const firstPaintStarts = new Map<string, number | null>();

/** Carry the static HTML's animation clock across Solid's client replacement.
 * A null clock means the CSS entrance already finished (or motion is disabled).
 * The cleanup limits this handoff to boot; later visits get a fresh entrance. */
export function preserveHeroEntrance(root: HTMLElement) {
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-hero-entrance]'
  )) {
    const animation = element
      .getAnimations()
      .find(
        (item) =>
          item instanceof CSSAnimation &&
          item.animationName.startsWith('home-hero-')
      );
    firstPaintStarts.set(
      element.dataset.heroEntrance!,
      animation
        ? Number(animation.startTime ?? document.timeline.currentTime ?? 0)
        : null
    );
  }
  return () => firstPaintStarts.clear();
}

/** CSS supplies the initial state even before JavaScript loads. */
export function heroEntrance(part: HeroPart) {
  return (element: HTMLElement) => {
    if (isServer) return;
    const start = firstPaintStarts.get(part);
    const preference = window.matchMedia(disabledMotionQuery);
    if (preference.matches || start === null) {
      element.dataset.heroEntered = '';
      return;
    }

    onMount(() => {
      const finish = () => {
        element.dataset.heroEntered = '';
        element.removeEventListener('animationend', handleEnd);
        element.removeEventListener('focusin', finish);
        preference.removeEventListener('change', handlePreference);
      };
      const handleEnd = (event: AnimationEvent) => {
        if (
          event.target === element &&
          event.animationName.startsWith('home-hero-')
        )
          finish();
      };
      const handlePreference = () => {
        if (preference.matches) finish();
      };
      element.addEventListener('animationend', handleEnd);
      element.addEventListener('focusin', finish);
      preference.addEventListener('change', handlePreference);
      const animation = element
        .getAnimations()
        .find(
          (item) =>
            item instanceof CSSAnimation &&
            item.animationName.startsWith('home-hero-')
        );
      if (animation && start !== undefined) animation.startTime = start;
      if (!animation || preference.matches) finish();
      onCleanup(finish);
    });
  };
}
