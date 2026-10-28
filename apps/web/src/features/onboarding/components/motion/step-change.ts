import { animateSecurityHandoff } from './security-handoff';
import { transitionOnboardingStep } from './step-transition';

/**
 * Swap one step's content for the next, choosing the handoff that carries the
 * story's visual anchors forward. Returns a cancel for an interrupted change.
 */
export function animateStepChange(
  content: HTMLElement,
  from: string,
  to: string,
  commit: () => void
): () => void {
  if (from === 'welcome' && to === 'vision')
    return animateSecurityHandoff(content, commit, 'intro');
  if (from === 'vision' && to === 'security')
    return animateSecurityHandoff(content, commit, 'features');
  if (from === 'security' && to === 'work')
    return animateSecurityHandoff(content, commit);
  return transitionOnboardingStep(content, commit);
}

/** After a swap: back to the top, focus on the new step's heading. */
export function focusStepHeading(content: HTMLElement, smooth = false) {
  content.closest('[data-onboarding-scroll]')?.scrollTo({
    top: 0,
    behavior:
      smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'instant',
  });
  content.querySelector('h1')?.focus({ preventScroll: true });
}
