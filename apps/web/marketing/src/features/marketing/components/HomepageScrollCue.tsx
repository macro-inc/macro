import ArrowDown from '@phosphor/arrow-down.svg';
import { onCleanup, onMount } from 'solid-js';
import './homepage-scroll-cue.css';

/** A quiet invitation to explore the homepage through native scrolling. */
export function HomepageScrollCue() {
  let button!: HTMLButtonElement;
  onMount(() => {
    const scroller = button.closest<HTMLElement>('[data-onboarding-scroll]');
    const observer = new IntersectionObserver(([entry]) => {
      button.dataset.visible = String(entry.isIntersecting);
    });
    const dismiss = () => {
      if (!scroller || scroller.scrollTop <= 0) return;
      button.dataset.dismissed = 'true';
      button.dataset.visible = 'false';
      button.inert = true;
      observer.disconnect();
      scroller.removeEventListener('scroll', dismiss);
    };
    observer.observe(button);
    scroller?.addEventListener('scroll', dismiss, { passive: true });
    dismiss();
    onCleanup(() => {
      observer.disconnect();
      scroller?.removeEventListener('scroll', dismiss);
    });
  });
  return (
    <button
      ref={button}
      type="button"
      class="homepage-scroll-cue"
      aria-label="Explore features"
      onClick={() => {
        const section = button
          .closest('.onboarding-flow')
          ?.querySelector('.homepage-unification');
        const scroller = section?.parentElement;
        scroller?.scrollBy({
          top: scroller.clientHeight * 0.8,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches
            ? 'instant'
            : 'smooth',
        });
      }}
    >
      <span>Explore</span>
      <ArrowDown aria-hidden="true" />
    </button>
  );
}
