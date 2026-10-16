import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** Owns one middle-button gesture; calendar geometry stays with Gantt.Root. */
export function createGanttPan(options: {
  viewport: Accessor<HTMLDivElement | undefined>;
  editing: Accessor<boolean>;
  setEditing: (editing: boolean) => void;
  clearGuide: () => void;
  panBy: (deltaX: number, deltaY: number) => void;
}) {
  const [panning, setPanning] = createSignal(false);
  let cancelGesture: (() => void) | undefined;

  function start(event: MouseEvent) {
    const viewport = options.viewport();
    if (event.button !== 1 || options.editing() || panning() || !viewport)
      return;

    event.preventDefault();
    event.stopPropagation();
    let x = event.clientX;
    let y = event.clientY;
    let finished = false;
    options.clearGuide();
    options.setEditing(true);
    setPanning(true);

    const finish = () => {
      // Removed listeners can still have queued callbacks; termination is final.
      if (finished) return;
      finished = true;
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', release, true);
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', finish);
      setPanning(false);
      options.setEditing(false);
      cancelGesture = undefined;
    };
    const move = (next: MouseEvent) => {
      if (finished) return;
      if (options.viewport() !== viewport || !(next.buttons & 4)) {
        finish();
        return;
      }
      next.preventDefault();
      next.stopPropagation();
      options.panBy(x - next.clientX, y - next.clientY);
      x = next.clientX;
      y = next.clientY;
    };
    const release = (next: MouseEvent) => {
      if (finished || next.button !== 1) return;
      next.preventDefault();
      next.stopPropagation();
      finish();
    };
    const cancelOnEscape = (next: KeyboardEvent) => {
      if (finished || next.key !== 'Escape') return;
      next.preventDefault();
      next.stopPropagation();
      finish();
    };

    cancelGesture = finish;
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', release, true);
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', finish);
  }

  const cancel = () => cancelGesture?.();
  onCleanup(cancel);

  return { panning, start, cancel };
}
