import { paneRoute } from '@app/routes/app-route';
import type {
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { describe, expect, it, vi } from 'vitest';
import { calendarViewContent, openCalendarView } from './calendar-navigation';

describe('Calendar view navigation', () => {
  it('builds route-backed component content', () => {
    expect(
      calendarViewContent({
        period: 'dayGridMonth',
        eventId: 'event-1',
        occurrenceKey: 'instance-1',
      })
    ).toMatchObject({
      type: 'component',
      id: 'calendar',
      params: {
        eventId: 'event-1',
        occurrenceKey: 'instance-1',
        focusRequestId: expect.any(Number),
      },
      entryMetadata: {
        route: paneRoute({
          id: 'view-calendar',
          params: { period: 'dayGridMonth' },
        }),
        search: {
          calendar: { eventId: ['event-1'], occurrenceKey: ['instance-1'] },
        },
      },
    });
  });

  it('retargets an existing Calendar component without a block handle', () => {
    const replace = vi.fn();
    const activate = vi.fn();
    const existing = { replace, activate } as unknown as SplitHandle;
    const manager = {
      getSplitByContent: vi.fn(() => existing),
      openWithSplit: vi.fn(),
    } as unknown as SplitManager;

    openCalendarView(
      { period: 'timeGridDay', eventId: 'event-2' },
      { manager }
    );

    expect(manager.getSplitByContent).toHaveBeenCalledWith(
      'component',
      'calendar'
    );
    expect(replace).toHaveBeenCalledWith({
      next: expect.objectContaining({
        type: 'component',
        id: 'calendar',
        entryMetadata: expect.objectContaining({
          search: { calendar: { eventId: ['event-2'] } },
        }),
      }),
      mergeHistory: true,
      referredFrom: undefined,
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(manager.openWithSplit).not.toHaveBeenCalled();
  });

  it('retargets an existing Calendar without taking focus when asked not to', () => {
    const replace = vi.fn();
    const activate = vi.fn();
    const manager = {
      getSplitByContent: vi.fn(() => ({ replace, activate })),
      openWithSplit: vi.fn(),
    } as unknown as SplitManager;

    openCalendarView({ eventId: 'event-4' }, { manager, activate: false });

    expect(replace).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });

  it('opens the Calendar route when no instance exists', () => {
    const manager = {
      getSplitByContent: vi.fn(),
      openWithSplit: vi.fn(),
    } as unknown as SplitManager;

    openCalendarView(
      { period: 'timeGridWeek', eventId: 'event-3' },
      { manager, openInNewSplit: true, referredFrom: 'sidebar' }
    );

    expect(manager.openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'component', id: 'calendar' }),
      {
        activate: true,
        referredFrom: 'sidebar',
        preferNewSplit: true,
        handle: undefined,
        mergeHistory: undefined,
      }
    );
  });

  it('says whether the Calendar opened', () => {
    const opened = {
      getSplitByContent: vi.fn(),
      openWithSplit: vi.fn(() => ({ status: 'navigating' })),
    } as unknown as SplitManager;
    const unavailable = {
      getSplitByContent: vi.fn(),
      openWithSplit: vi.fn(() => ({ status: 'unavailable' })),
    } as unknown as SplitManager;

    expect(openCalendarView({}, { manager: opened })).toBe(true);
    expect(openCalendarView({}, { manager: unavailable })).toBe(false);
  });
});
