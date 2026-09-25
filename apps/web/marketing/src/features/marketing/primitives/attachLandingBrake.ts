/** A short, interruptible brake for fast downward wheel input at the footer. */
export function attachLandingBrake(
  scroller: HTMLElement,
  reduced: MediaQueryList,
  range: () => { start: number; end: number },
  onFrame: () => void
) {
  let listening = false;
  let active = false;
  let frame = 0;
  let target = 0;
  let written = scroller.scrollTop;
  let lastFrame = 0;
  let lastWheel = 0;

  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    active = false;
    lastWheel = 0;
  };
  const tick = (now: number) => {
    const dt = Math.min(32, now - lastFrame);
    lastFrame = now;
    // Keep subpixel position internally: browsers can round scrollTop, which
    // otherwise leaves an easing loop stuck a few pixels from its target.
    const remaining = target - written;
    // Cap entry speed, then dissipate momentum without overshooting or bouncing.
    const step = Math.min(1.8 * dt, remaining * (1 - Math.exp(-dt / 85)));
    written = remaining < 1 ? target : written + step;
    scroller.scrollTop = written;
    onFrame();
    if (remaining < 1) {
      cancel();
      sync();
    } else frame = requestAnimationFrame(tick);
  };
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented) {
      cancel();
      return;
    }
    if (event.deltaY <= 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      cancel();
      return;
    }
    if (!event.cancelable) return;
    const { start, end } = range();
    const current = scroller.scrollTop;
    if (current >= end - 1) return;
    const delta =
      event.deltaY *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? scroller.clientHeight
          : 1);
    const now = performance.now();
    const interval = now - lastWheel;
    const fast =
      delta >= 180 ||
      (lastWheel > 0 && interval < 60 && delta / Math.max(8, interval) > 1.8);
    lastWheel = now;
    if (!active && (!fast || current + delta <= start)) return;
    event.preventDefault();
    target = Math.min(end, (active ? target : current) + delta);
    if (active) return;
    active = true;
    // The part before the landing zone still travels at native speed.
    written = Math.max(current, Math.min(start, target));
    scroller.scrollTop = written;
    lastFrame = now;
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    if (active && Math.abs(scroller.scrollTop - written) > 2) cancel();
    const { start, end } = range();
    const nearby =
      !reduced.matches &&
      scroller.scrollTop >= start - scroller.clientHeight &&
      (active || scroller.scrollTop < end - 1);
    if (nearby === listening) return;
    listening = nearby;
    if (nearby) scroller.addEventListener('wheel', wheel, { passive: false });
    else {
      scroller.removeEventListener('wheel', wheel);
      cancel();
    }
  };
  scroller.addEventListener('scroll', sync, { passive: true });
  scroller.addEventListener('pointerdown', cancel, { passive: true });
  scroller.addEventListener('touchstart', cancel, { passive: true });
  document.addEventListener('keydown', cancel);
  reduced.addEventListener('change', sync);
  sync();
  return {
    isActive: () => active,
    refresh: () => {
      cancel();
      sync();
    },
    dispose: () => {
      cancel();
      scroller.removeEventListener('wheel', wheel);
      scroller.removeEventListener('scroll', sync);
      scroller.removeEventListener('pointerdown', cancel);
      scroller.removeEventListener('touchstart', cancel);
      document.removeEventListener('keydown', cancel);
      reduced.removeEventListener('change', sync);
    },
  };
}
