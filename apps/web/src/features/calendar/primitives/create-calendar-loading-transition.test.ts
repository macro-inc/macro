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

  it('holds a shown skeleton for its minimum unless given none', () => {
    const phaseAfterLoad = (minimumVisibleMs?: number) => {
      let phase: CalendarLoadingPhase | undefined;

      createRoot((dispose) => {
        const transition = createCalendarLoadingTransition(
          undefined,
          minimumVisibleMs
        );

        transition.setLoading(true);
        vi.advanceTimersByTime(200);
        transition.setLoading(false);
        vi.advanceTimersByTime(1);
        phase = transition.phase();
        dispose();
      });

      return phase;
    };

    expect(phaseAfterLoad()).toBe('visible');
    expect(phaseAfterLoad(0)).toBe('leaving');
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
