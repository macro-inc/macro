// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  CalendarCallsActions,
  CalendarCallsSource,
} from '../context/calendar-calls';
import type { CalendarCallItem } from '../core/calendar-calls';
import { createCalendarCalls } from './calendar-calls';

describe('calendar call selection ownership', () => {
  it('never transfers rename or revoke confirmation to a different link after a refresh', async () => {
    const item = (id: string): CalendarCallItem => ({
      id,
      title: id,
      group: 'instant',
      link: {
        id,
        title: id,
        url: `https://macro.com/app/meet/${id}`,
        shareToken: id,
      },
    });
    const [items, setItems] = createSignal([item('one'), item('two')]);
    const source: CalendarCallsSource = {
      items,
      loading: () => false,
      error: () => undefined,
      refreshing: () => false,
      hasMore: () => false,
      loadMore: vi.fn(),
      refresh: vi.fn(),
    };
    const actions: CalendarCallsActions = {
      schedule: vi.fn(),
      join: vi.fn(),
      copy: vi.fn(),
      openRecord: vi.fn(),
      rename: vi.fn(),
      revoke: vi.fn(),
    };
    const { state, dispose } = createRoot((dispose) => ({
      state: createCalendarCalls(source, actions),
      dispose,
    }));
    state.select(items()[0]);
    state.setConfirmRevoke(true);
    state.startEditing();
    state.setTitle('Renamed');
    setItems([item('two')]);
    expect(state.selected()).toBeUndefined();
    expect(state.confirmRevoke()).toBe(false);
    expect(state.editing()).toBe(false);
    await state.revoke();
    await state.save();
    expect(actions.revoke).not.toHaveBeenCalled();
    expect(actions.rename).not.toHaveBeenCalled();
    dispose();
  });
});
