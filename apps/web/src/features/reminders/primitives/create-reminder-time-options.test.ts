import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminderTimeOptions } from './create-reminder-time-options';

describe('createReminderTimeOptions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Friday afternoon so "tomorrow" and weekday shorthands are unambiguous
    vi.setSystemTime(new Date('2026-10-09T15:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves tmrw to tomorrow morning', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tmrw');
      const options = createReminderTimeOptions(query);
      const tomorrow = options().find((option) =>
        option.label.toLowerCase().includes('tomorrow')
      );
      expect(tomorrow).toBeTruthy();
      expect(tomorrow?.date.getDate()).toBe(10);
      expect(tomorrow?.date.getHours()).toBe(9);
      dispose();
    });
  });

  it('resolves tmrw 8 to tomorrow at 8am', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tmrw 8');
      const options = createReminderTimeOptions(query);
      expect(options().length).toBeGreaterThan(0);
      const match = options()[0];
      expect(match.date.getDate()).toBe(10);
      expect(match.date.getHours()).toBe(8);
      expect(match.date.getMinutes()).toBe(0);
      dispose();
    });
  });

  it('resolves tmrw 8p to tomorrow at 8pm', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tmrw 8p');
      const options = createReminderTimeOptions(query);
      expect(options().length).toBeGreaterThan(0);
      const match = options()[0];
      expect(match.label.toLowerCase()).toContain('8 pm');
      expect(match.date.getDate()).toBe(10);
      expect(match.date.getHours()).toBe(20);
      dispose();
    });
  });

  it('resolves weekday shorthands like fri and thu', () => {
    createRoot((dispose) => {
      for (const [queryText, expectedDay] of [
        ['fri', 5],
        ['thu', 4],
        ['mon', 1],
      ] as const) {
        const [query] = createSignal(queryText);
        const options = createReminderTimeOptions(query);
        expect(options().length).toBeGreaterThan(0);
        expect(options()[0].date.getDay()).toBe(expectedDay);
      }
      dispose();
    });
  });
});
