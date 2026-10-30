/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';
import { createCalendarEventSelection } from './CalendarViewContext';

vi.mock('../hooks/use-calendar-sources', () => ({
  useCalendarSources: vi.fn(),
}));
vi.mock('../utils/preferences', () => ({
  useCalendarPreferences: vi.fn(),
}));

const EVENT = { id: 'ooo', eventId: 'ooo-1' } as CalendarEvent;

function withSelection(
  run: (selection: ReturnType<typeof createCalendarEventSelection>) => void
) {
  createRoot((dispose) => {
    run(createCalendarEventSelection());
    dispose();
  });
}

describe('createCalendarEventSelection', () => {
  it('keeps a list selection on its row when the chip mounts', () => {
    withSelection((selection) => {
      const row = document.createElement('button');
      const chip = document.createElement('a');

      selection.select(EVENT, row, 'agenda');
      selection.reanchor(EVENT, chip);

      expect(selection.anchor()).toBe(row);
      expect(selection.origin()).toBe('agenda');
    });
  });

  it('moves a grid selection to the chip that replaced its own', () => {
    withSelection((selection) => {
      const chip = document.createElement('a');
      const remounted = document.createElement('a');

      selection.select(EVENT, chip);
      selection.reanchor(EVENT, remounted);

      expect(selection.anchor()).toBe(remounted);
    });
  });
});
