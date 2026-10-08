import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createTeamCalendarState } from './create-team-calendar-state';

describe('team calendar state', () => {
  it('drops stale details on a denied refresh and on a disabled identity', () => {
    createRoot((dispose) => {
      const [error, setError] = createSignal(false);
      const [enabled, setEnabled] = createSignal(true);
      const state = createTeamCalendarState(
        {
          data: () => ['Previously authorized title'],
          isPending: () => false,
          isError: error,
        },
        enabled
      );
      expect(state.items()).toEqual(['Previously authorized title']);
      setError(true);
      expect(state.items()).toEqual([]);
      expect(state.isError()).toBe(true);
      setEnabled(false);
      setError(false);
      expect(state.items()).toEqual([]);
      dispose();
    });
  });
});

it('hides retained details when an offline refresh is paused', () => {
  createRoot((dispose) => {
    const [paused, setPaused] = createSignal(false);
    const state = createTeamCalendarState(
      {
        data: () => ['Previously authorized title'],
        isPending: () => false,
        isError: () => false,
        isPaused: paused,
      },
      () => true
    );
    expect(state.items()).toHaveLength(1);
    setPaused(true);
    expect(state.items()).toEqual([]);
    expect(state.isError()).toBe(true);
    dispose();
  });
});
