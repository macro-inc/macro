import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHomeCalendarPreview } from './home-calendar-preview';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => {}),
  openCalendarView: vi.fn(),
  calendarSplit: undefined as object | undefined,
  homeCalendarParams: {} as { period?: string },
}));

vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => mocks.navigate,
  useRouteParams: () => mocks.homeCalendarParams,
  createSearchParams: () => [{}],
}));
vi.mock('@app/routes/routes', () => ({ homeCalendarRoute: 'home-calendar' }));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    getSplitByContent: (type: string, id: string) =>
      type === 'component' && id === 'calendar'
        ? mocks.calendarSplit
        : undefined,
  }),
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  openCalendarView: mocks.openCalendarView,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isFeatureEnabled: () => true,
}));
vi.mock('@components/app/previewTarget', () => ({
  previewCalendarTarget: (entity: { id: string; occurrenceKey?: string }) => ({
    eventId: entity.id,
    occurrenceKey: entity.occurrenceKey,
  }),
}));

const event = {
  type: 'calendar_event',
  id: 'event-1',
  occurrenceKey: '2026-10-24T18:00:00Z',
} as never;

function openFromHome(options?: { activate?: boolean }) {
  return createRoot((dispose) => {
    const preview = useHomeCalendarPreview((search) => search);
    const opened = preview.openCalendarEvent(event, options);
    dispose();
    return opened;
  });
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.calendarSplit = undefined;
  mocks.homeCalendarParams = {};
});

describe('Home calendar preview', () => {
  it('opens the event inside Home when no Calendar split is open', () => {
    expect(openFromHome({ activate: true })).toBe(true);

    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.openCalendarView).not.toHaveBeenCalled();
  });

  it('retargets and focuses a Calendar already open in another split on a click', () => {
    mocks.calendarSplit = {};

    expect(openFromHome({ activate: true })).toBe(true);

    expect(mocks.openCalendarView).toHaveBeenCalledWith(
      { eventId: 'event-1', occurrenceKey: '2026-10-24T18:00:00Z' },
      { activate: true, referredFrom: 'home' }
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps the event in Home's own calendar while it is open beside a Calendar split", () => {
    mocks.calendarSplit = {};
    mocks.homeCalendarParams = { period: 'week' };

    expect(openFromHome({ activate: true })).toBe(true);

    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.openCalendarView).not.toHaveBeenCalled();
  });

  it('retargets the open Calendar without focusing it while browsing the list', () => {
    mocks.calendarSplit = {};

    expect(openFromHome()).toBe(true);

    expect(mocks.openCalendarView).toHaveBeenCalledWith(
      { eventId: 'event-1', occurrenceKey: '2026-10-24T18:00:00Z' },
      { activate: false, referredFrom: 'home' }
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
