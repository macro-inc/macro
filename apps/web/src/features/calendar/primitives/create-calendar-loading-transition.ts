import { createSignal, onCleanup } from 'solid-js';

export type CalendarLoadingPhase = 'hidden' | 'waiting' | 'visible' | 'leaving';

/** Controls loading decoration timing without subscribing to the loading source. */
export function createCalendarLoadingTransition(
  onPhaseChange?: (phase: CalendarLoadingPhase) => void
) {
  const [phase, updatePhase] = createSignal<CalendarLoadingPhase>('hidden');
  const setPhase = (next: CalendarLoadingPhase) => {
    updatePhase(next);
    onPhaseChange?.(next);
  };
  let loading = false;
  let visibleSince = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const startLeaving = () => {
    setPhase('leaving');
    timer = setTimeout(() => {
      timer = undefined;
      setPhase('hidden');
    }, 180);
  };

  const reset = () => {
    clearTimer();
    loading = false;
    setPhase('hidden');
  };
  onCleanup(reset);

  const setLoading = (next: boolean) => {
    if (next === loading) return;
    loading = next;
    clearTimer();

    if (next) {
      if (phase() === 'visible') return;
      if (phase() === 'leaving') {
        visibleSince = Date.now();
        setPhase('visible');
        return;
      }
      setPhase('waiting');
      timer = setTimeout(() => {
        timer = undefined;
        visibleSince = Date.now();
        setPhase('visible');
      }, 120);
      return;
    }

    if (phase() === 'waiting') {
      setPhase('hidden');
      return;
    }
    if (phase() === 'visible') {
      const remaining = Math.max(0, 240 - (Date.now() - visibleSince));
      if (remaining === 0) startLeaving();
      else timer = setTimeout(startLeaving, remaining);
    }
  };

  return { phase, setLoading, reset };
}
