/** Small compositor-only handoff, with no motion for reduced-motion users. */
export function animateOnboardingStep(
  element: HTMLElement,
  direction: 'in' | 'out'
) {
  if (
    typeof element.animate !== 'function' ||
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    return;

  return element.animate(
    direction === 'in'
      ? [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ]
      : [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-6px)' },
        ],
    {
      duration: direction === 'in' ? 260 : 160,
      easing: 'cubic-bezier(.22,1,.36,1)',
      fill: direction === 'in' ? 'none' : 'forwards',
    }
  );
}

/** Fade between account decisions without accepting duplicate actions mid-handoff. */
export function transitionOnboardingStep(
  element: HTMLElement,
  commit: () => void
) {
  let cancelled = false;
  let animation = animateOnboardingStep(element, 'out');
  const finish = () => {
    if (cancelled) return;
    animation?.cancel();
    commit();
    animation = animateOnboardingStep(element, 'in');
    element.inert = false;
  };
  element.inert = true;
  if (animation) animation.onfinish = finish;
  else finish();
  return () => {
    cancelled = true;
    animation?.cancel();
    element.inert = false;
  };
}
