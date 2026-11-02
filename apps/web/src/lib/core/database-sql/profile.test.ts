import type { Span } from '@macro-inc/observability';
import { afterEach, expect, it, vi } from 'vitest';
import { profileDatabasePhase, traceDatabaseFrame } from './profile';

function span() {
  return {
    run: <T>(operation: () => T) => operation(),
    setAttr: vi.fn(),
    end: vi.fn(),
  } as unknown as Span;
}

afterEach(() => vi.restoreAllMocks());

it('ends a synchronous phase even when it throws', () => {
  const phase = span();
  expect(() =>
    profileDatabasePhase(phase, () => {
      throw new Error('failed');
    })
  ).toThrow('failed');
  expect(phase.end).toHaveBeenCalledTimes(1);
});

it('waits for two frames and records a frame opportunity, not a paint timestamp', () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
    callbacks.push(callback)
  );
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const phase = span();
  const cancel = traceDatabaseFrame(phase);
  callbacks[0](0);
  expect(phase.end).not.toHaveBeenCalled();
  callbacks[1](16);
  expect(phase.setAttr).toHaveBeenCalledWith(
    'database_sql.frame_status',
    'ready'
  );
  cancel();
  expect(phase.end).toHaveBeenCalledTimes(1);
});

it('cancels a superseded result before recording a ready frame', () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
  const cancelled = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation(() => {});
  const phase = span();
  traceDatabaseFrame(phase)();
  expect(cancelled).toHaveBeenCalledWith(7);
  expect(phase.setAttr).toHaveBeenCalledWith(
    'database_sql.frame_status',
    'cancelled'
  );
  expect(phase.end).toHaveBeenCalledTimes(1);
});

it('does not call a hidden document a ready frame', () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const request = vi.spyOn(window, 'requestAnimationFrame');
  const phase = span();
  traceDatabaseFrame(phase)();
  expect(request).not.toHaveBeenCalled();
  expect(phase.setAttr).toHaveBeenCalledWith(
    'database_sql.frame_status',
    'hidden'
  );
  expect(phase.end).toHaveBeenCalledTimes(1);
});

it('ends a frame span if animation frames never arrive', () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const phase = span();
    const cancel = traceDatabaseFrame(phase);
    vi.advanceTimersByTime(10_000);
    expect(phase.setAttr).toHaveBeenCalledWith(
      'database_sql.frame_status',
      'timeout'
    );
    cancel();
    expect(phase.end).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
