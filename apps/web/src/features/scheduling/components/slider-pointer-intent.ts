/** A stationary thumb press focuses the control without snapping its exact value. */
export function createSliderPointerIntent() {
  let origin: { id: number; x: number; y: number } | undefined;
  const move = (event: PointerEvent) => {
    if (
      origin &&
      event.pointerId === origin.id &&
      (event.clientX !== origin.x || event.clientY !== origin.y)
    )
      origin = undefined;
  };
  return {
    thumbDown(event: PointerEvent) {
      if (event.button !== 0 || event.isPrimary === false) return;
      origin = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    move,
    end() {
      // Keep the guard through Kobalte's pointer-up and capture-release handlers.
      const finished = origin;
      queueMicrotask(() => {
        if (origin === finished) origin = undefined;
      });
    },
    ignoresChange: () => origin !== undefined,
  };
}
