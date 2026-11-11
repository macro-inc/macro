import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CalendarLoadingPhase,
  createCalendarLoadingTransition,
} from './create-calendar-loading-transition';

describe('calendar loading transition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips the skeleton when the answer was queued behind a long mount', () => {
    const phases: CalendarLoadingPhase[] = [];

    createRoot((dispose) => {
      const transition = createCalendarLoadingTransition((phase) =>
        phases.push(phase)
      );

      transition.setLoading(true);

      // The thread was blocked past the show delay: everything already
      // scheduled is overdue and runs before the queued answer.
      vi.runOnlyPendingTimers();
      transition.setLoading(false);

      vi.runAllTimers();
      dispose();
    });

    expect(phases).not.toContain('visible');
  });

  it('shows the skeleton when a load outlasts the delay', () => {
    const phases: CalendarLoadingPhase[] = [];

    createRoot((dispose) => {
      const transition = createCalendarLoadingTransition((phase) =>
        phases.push(phase)
      );

      transition.setLoading(true);
      vi.advanceTimersByTime(1000);
      transition.setLoading(false);

      vi.runAllTimers();
      dispose();
    });

    expect(phases).toContain('visible');
  });
});
