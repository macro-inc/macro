import { attachLandingBrake } from '../primitives/attachLandingBrake';

/** Move the existing app link into the closing space without duplicating it. */
export function animateHomepageCta(
  root: HTMLElement,
  destination: HTMLElement
) {
  const button = root
    .closest('.onboarding-flow')
    ?.querySelector<HTMLAnchorElement>('.site-header .site-nav-start');
  if (!button) return () => {};
  let scroller = root.parentElement!;
  while (
    scroller.parentElement &&
    !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
  ) {
    scroller = scroller.parentElement;
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const originalTransform = button.style.transform;
  const originalOrigin = button.style.transformOrigin;
  const originalOpacity = button.style.opacity;
  const originalTransition = button.style.transition;
  const originalWillChange = button.style.willChange;
  const closing = destination.closest('footer') ?? destination;
  let maxScroll = 0;
  let startScroll = 0;
  let travel = 1;
  let dx = 0;
  let dy = 0;
  let scale = 3;
  let narrow = false;
  let startCenterY = 0;
  let startHeight = 0;
  let cssScale = 1;
  let contentBottom = 0;
  let lastRaw = -1;
  let lastUpdate = 0;
  let settling = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let brake: ReturnType<typeof attachLandingBrake> | undefined;
  const stopSettling = () => {
    clearTimeout(settleTimer);
    settling = false;
    button.style.transition = originalTransition;
    button.style.willChange = originalWillChange;
  };

  const update = () => {
    const raw = Math.max(
      0,
      Math.min(1, (scroller.scrollTop - startScroll) / travel)
    );
    if (raw === lastRaw) return;
    const now = performance.now();
    if (reduced.matches || raw < lastRaw || brake?.isActive()) stopSettling();
    else if (
      lastRaw >= 0 &&
      raw > lastRaw &&
      (raw - lastRaw > 0.25 || (raw - lastRaw > 0.1 && now - lastUpdate < 80))
    ) {
      // Native touch momentum, keyboard jumps and scrollbar drags keep native
      // scrolling. Only the button catches up, using compositor transitions.
      settling = true;
      button.style.transition =
        'transform 420ms cubic-bezier(.16, 1, .3, 1), opacity 240ms ease';
    }
    if (settling) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(stopSettling, 450);
    }
    button.style.willChange =
      (raw > 0 && raw < 1) || settling
        ? 'transform, opacity'
        : originalWillChange;
    lastRaw = raw;
    lastUpdate = now;
    const progress = reduced.matches
      ? raw >= 0.999
        ? 1
        : 0
      : raw * raw * (3 - 2 * raw);
    // The arc descends along the right margin, then turns into the closing
    // space. Grow with the inward motion so the button stays small beside work.
    const inward = progress ** 6;
    const downward = 1 - (1 - progress) ** 3;
    button.style.transform = `translate(${dx * inward}px, ${dy * downward}px) scale(${1 + (scale - 1) * inward})`;
    let opacity = 1 - 0.55 * Math.sin(Math.PI * progress) ** 2;
    if (narrow && !reduced.matches) {
      // Phones have no outer margin to travel through. Fade out at the header
      // and back in once the button clears the last graphic.
      const top =
        startCenterY +
        dy * downward * cssScale -
        (startHeight * (1 + (scale - 1) * inward)) / 2;
      const clearance = Math.max(
        0,
        Math.min(1, (top - (contentBottom - scroller.scrollTop) - 12) / 32)
      );
      opacity *= Math.max(Math.max(0, 1 - progress / 0.025), clearance);
    }
    button.style.opacity = `${opacity}`;
  };
  const measure = () => {
    stopSettling();
    lastRaw = -1;
    button.style.transform = originalTransform;
    button.style.transformOrigin = 'center';
    const start = button.getBoundingClientRect();
    const end = destination.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    cssScale = start.width / button.offsetWidth;
    narrow = viewport.width < 700;
    startCenterY = start.top + start.height / 2;
    startHeight = start.height;
    contentBottom =
      scroller.scrollTop +
      (closing.previousElementSibling?.getBoundingClientRect().bottom ??
        closing.getBoundingClientRect().top);
    maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const closingTop =
      scroller.scrollTop + closing.getBoundingClientRect().top - viewport.top;
    // The compact footer enters near the bottom of the viewport. Keep enough
    // scroll for the right-margin arc without reserving a blank full screen.
    startScroll = Math.max(
      0,
      Math.min(
        closingTop - scroller.clientHeight * 0.82,
        maxScroll - scroller.clientHeight * 0.32
      )
    );
    startScroll = Math.min(startScroll, maxScroll - 1);
    travel = Math.max(1, maxScroll - startScroll);
    scale = Math.min(3, (viewport.width - 48) / start.width);
    dx = (end.left + end.width / 2 - start.left - start.width / 2) / cssScale;
    dy =
      (end.top +
        end.height / 2 -
        (maxScroll - scroller.scrollTop) -
        start.top -
        start.height / 2) /
      cssScale;
    brake?.refresh();
    update();
  };
  const resize = new ResizeObserver(measure);
  resize.observe(root);
  resize.observe(destination);
  resize.observe(closing);
  resize.observe(scroller);
  resize.observe(button);
  scroller.addEventListener('scroll', update, { passive: true });
  reduced.addEventListener('change', measure);
  measure();
  brake = attachLandingBrake(
    scroller,
    reduced,
    () => ({ start: startScroll, end: maxScroll }),
    update
  );
  return () => {
    resize.disconnect();
    scroller.removeEventListener('scroll', update);
    reduced.removeEventListener('change', measure);
    brake?.dispose();
    stopSettling();
    button.style.transform = originalTransform;
    button.style.transformOrigin = originalOrigin;
    button.style.opacity = originalOpacity;
  };
}
