/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EventReplacementController } from '../context/event-replacement-source';
import type { EventReplacementPreview } from '../core/event-replacement';
import { EventReplacementDialog } from './EventReplacementDialog';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The dialog showing a prepared preview, as the provider answers an all-day event: an exclusive end date. */
function showPreview(preview: Partial<EventReplacementPreview>) {
  const controller: EventReplacementController = {
    open: () => true,
    close: vi.fn(),
    pending: () => false,
    error: () => undefined,
    preview: () => ({
      operationId: 'operation',
      status: 'needs_confirmation',
      title: 'Offsite',
      startsAt: '2030-01-04',
      endsAt: '2030-01-05',
      allDay: true,
      attendeeCount: 2,
      isSeries: false,
      removeConference: true,
      completedSteps: 0,
      totalSteps: 2,
      ...preview,
    }),
    confirmationAttempted: () => false,
    start: vi.fn(),
    prepare: vi.fn(),
    confirm: vi.fn(),
    check: vi.fn(),
  };
  render(() => (
    <EventReplacementDialog
      controller={controller}
      timeFormat="12-hour"
      onOpenUrl={vi.fn()}
      onDone={vi.fn()}
    />
  ));
}

it('reads a one-day all-day replacement as that one day', () => {
  showPreview({ startsAt: '2030-01-04', endsAt: '2030-01-05' });

  expect(screen.getByText('Fri, January 4 · All day')).toBeTruthy();
});

it('reads a two-day all-day replacement as its two days', () => {
  showPreview({ startsAt: '2030-01-04', endsAt: '2030-01-06' });

  expect(screen.getByText('Jan 4–Jan 5 · All day')).toBeTruthy();
});
