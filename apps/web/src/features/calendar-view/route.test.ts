import {
  createRoutesManifest,
  decodeRoute,
  encodeRoute,
  getRouteClaim,
  getRouteSearchNamespaces,
  routeParams,
} from '@app/lib/split-router';
import { describe, expect, it } from 'vitest';
import { CALENDAR_SEARCH_NAMESPACE, calendarSearchCodec } from './calendar-url';
import { calendarSplitRoute } from './route';

const routes = createRoutesManifest({ definitions: [calendarSplitRoute] });

describe('Calendar split route', () => {
  it.each([
    ['month', 'dayGridMonth'],
    ['week', 'timeGridWeek'],
    ['day', 'timeGridDay'],
  ] as const)('round-trips the %s period', (pathPeriod, period) => {
    const entry = decodeRoute(routes, ['calendar', pathPeriod]);
    expect(entry).toBeDefined();
    expect(routeParams(entry?.location.route)).toEqual({ period });
    expect(encodeRoute(routes, entry!)).toEqual(['calendar', pathPeriod]);
    expect(getRouteSearchNamespaces(routes, entry!.location.route)).toEqual(
      new Set([CALENDAR_SEARCH_NAMESPACE])
    );
    expect(getRouteClaim(routes, entry!.location.route)).toEqual({
      namespace: 'component',
      id: 'calendar',
    });
  });

  it('rejects missing and unknown periods', () => {
    expect(decodeRoute(routes, ['calendar'])).toBeUndefined();
    expect(decodeRoute(routes, ['calendar', 'agenda'])).toBeUndefined();
  });

  it('serializes only a non-empty focused event id', () => {
    expect(calendarSearchCodec.serialize({ eventId: '' })).toBeUndefined();
    expect(calendarSearchCodec.serialize({ eventId: 'event-1' })).toEqual({
      eventId: ['event-1'],
    });
    expect(calendarSearchCodec.parse({ eventId: ['event-1'] })).toEqual({
      value: { eventId: 'event-1' },
      valid: true,
    });
  });
});
