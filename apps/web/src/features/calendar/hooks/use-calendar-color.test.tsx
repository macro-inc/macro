/**
 * @vitest-environment jsdom
 */

import type { CalendarColorChange } from '@queries/calendar/colors';
import type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useSetCalendarColor,
  useUploadBrowserCalendarColors,
} from './use-calendar-color';
import { useCalendarSources } from './use-calendar-sources';

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn<(change: CalendarColorChange) => Promise<void>>(),
  failure: vi.fn<(message: string) => void>(),
  started: [] as Promise<unknown>[],
}));

/** Every save the hooks started, settled. */
const settled = () => Promise.all(state.started);

const [calendars, setCalendars] = createSignal<VisibleCalendar[]>();
const [preferences, setPreferences] = createStore<{
  sourceColors: Record<string, string | undefined>;
  accountColors: Record<string, string | undefined>;
}>({ sourceColors: {}, accountColors: {} });

vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (work: Promise<unknown>) => {
    state.started.push(work);
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'alice',
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: state.failure },
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({
    get isSuccess() {
      return calendars() !== undefined;
    },
    get isPending() {
      return calendars() === undefined;
    },
    get data() {
      return calendars();
    },
  }),
}));
vi.mock('@queries/calendar/colors', () => ({
  useSetCalendarColorMutation: () => ({ mutateAsync: state.mutateAsync }),
}));
vi.mock('../utils/preferences', () => ({
  useCalendarPreferences: () => [preferences, setPreferences],
}));

function calendar(
  id: string,
  customColor: string | null,
  emailLinkId = 'link'
): VisibleCalendar {
  return {
    id,
    emailLinkId,
    emailAddress: 'alice@example.com',
    name: id,
    color: '#9fe1e7',
    customColor,
    provider: 'google',
    capabilities: {
      autoDecline: true,
      conferenceProvider: 'google_meet',
      customRecurrence: true,
      emailReminders: true,
      removeConference: true,
      resetRsvp: true,
      guestPolicy: true,
    },
    isPrimary: id === 'primary',
    isWritable: true,
    isSubscription: false,
    contributesToAvailability: true,
    syncError: null,
    defaultReminders: [],
  };
}

/** Each upload, answered by the test. */
function pendingSaves() {
  const saves: {
    change: CalendarColorChange;
    settle: PromiseWithResolvers<void>;
  }[] = [];
  state.mutateAsync.mockImplementation((change) => {
    const settle = Promise.withResolvers<void>();
    saves.push({ change, settle });
    return settle.promise;
  });
  return saves;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.started.length = 0;
  setCalendars(undefined);
  setPreferences({ sourceColors: {}, accountColors: {} });
});

afterEach(cleanup);

describe('a calendar color saved in this browser', () => {
  it('moves to the account and leaves the browser once the server confirms it', async () => {
    const saves = pendingSaves();
    setPreferences('sourceColors', { primary: '#5C8AEE' });
    render(() => {
      useUploadBrowserCalendarColors();
      return null;
    });

    setCalendars([calendar('primary', null)]);

    expect(saves.map(({ change }) => change)).toEqual([
      { userId: 'alice', calendarId: 'primary', color: '#5c8aee' },
    ]);
    expect(preferences.sourceColors.primary).toBe('#5C8AEE');
    saves[0].settle.resolve();
    await settled();

    expect(preferences.sourceColors.primary).toBeUndefined();
  });

  it('stays in the browser when the upload fails, for the next load to retry', async () => {
    const saves = pendingSaves();
    setPreferences('sourceColors', { primary: '#5c8aee' });
    render(() => {
      useUploadBrowserCalendarColors();
      return null;
    });
    setCalendars([calendar('primary', null)]);

    saves[0].settle.reject(new Error('offline'));
    await settled();
    setCalendars([calendar('primary', null)]);

    expect(preferences.sourceColors.primary).toBe('#5c8aee');
    expect(saves).toHaveLength(1);
  });

  it("gives way to the account's color, and waits for a calendar this account lists", () => {
    const saves = pendingSaves();
    setPreferences('sourceColors', {
      primary: '#5c8aee',
      elsewhere: '#ed6a86',
    });
    render(() => {
      useUploadBrowserCalendarColors();
      return null;
    });

    setCalendars([calendar('primary', '#8bbf96')]);

    expect(saves).toHaveLength(0);
    expect(preferences.sourceColors).toEqual({ elsewhere: '#ed6a86' });
  });
});

describe('calendar colors', () => {
  it("show the person's own color over this browser's and the account default", () => {
    setPreferences({
      sourceColors: { pending: '#ed6a86', work: '#57b6b0' },
      accountColors: { link: '#b39583' },
    });
    setCalendars([
      calendar('work', '#5c8aee'),
      calendar('pending', null),
      calendar('primary', null),
      calendar('other', null, 'other-link'),
    ]);
    let sources!: ReturnType<typeof useCalendarSources>;
    render(() => {
      sources = useCalendarSources();
      return null;
    });

    expect(
      sources
        .sources()
        .map(({ id, color, hasCustomColor }) => [id, color, hasCustomColor])
    ).toEqual([
      ['work', '#5c8aee', true],
      ['pending', '#ed6a86', true],
      ['primary', '#b39583', false],
      ['other', '#9fe1e7', false],
    ]);
  });

  it('saves a choice to the account and drops what this browser held', async () => {
    const saves = pendingSaves();
    setPreferences('sourceColors', { primary: '#ed6a86' });
    let setColor!: ReturnType<typeof useSetCalendarColor>;
    render(() => {
      setColor = useSetCalendarColor();
      return null;
    });

    setColor('primary', undefined);
    saves[0].settle.resolve();
    await settled();

    expect(saves[0].change).toEqual({
      userId: 'alice',
      calendarId: 'primary',
      color: null,
    });
    expect(preferences.sourceColors.primary).toBeUndefined();
    expect(state.failure).not.toHaveBeenCalled();
  });
});
