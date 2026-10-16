type Point = { x: number; y: number };

/** Gate previews during fast travel; a stationary pointer settles after 100 ms. */
export function createKanbanPointerIntent(options: {
  speed(): number | undefined;
  settled(): void;
}) {
  let previous: (Point & { time: number }) | undefined;
  let blocked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function reset(point?: Point) {
    clearTimeout(timer);
    previous = point ? { ...point, time: performance.now() } : undefined;
    blocked = false;
  }

  function update(point: Point) {
    const threshold = options.speed();

    if (!threshold || !previous) {
      previous = { ...point, time: performance.now() };
      return true;
    }

    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);

    if (distance === 0) {
      return !blocked;
    }

    const time = performance.now();
    const speed = (distance * 1000) / Math.max(16, time - previous.time);
    previous = { ...point, time };
    blocked = speed > threshold * (blocked ? 0.6 : 1);
    clearTimeout(timer);

    if (blocked) {
      timer = setTimeout(() => {
        blocked = false;
        options.settled();
      }, 100);
    }

    return !blocked;
  }

  return { update, reset };
}
