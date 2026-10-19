import {
  newEventType,
  newSchedule,
  schedulingProfileForSave,
} from '@app/features/scheduling/core/types';
import {
  deserializeToolCall,
  deserializeToolResponse,
} from '@service-cognition/generated/tools/tool';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { createBookingLinkHandler } from './BookingLinks';
import { ToolErrorContext } from './ToolRenderer';

afterEach(cleanup);
const schedule = newSchedule('UTC');
const draft = {
  event: {
    ...newEventType(schedule.id, ['macro|host@example.test'], false),
    title: 'Intro',
    slug: 'intro',
  },
  schedule,
};
const context = {
  tool: {
    id: 'booking-call',
    name: 'CreateBookingLink' as const,
    data: { draft, userConfirmation: 'Yes, create it.' },
  },
  chat_id: 'chat',
  message_id: 'message',
  part_index: 0,
  isComplete: true,
  renderContext: { isStreaming: false, followedBy: () => false },
};
it('never opens an editable review when saving fails', () => {
  const view = render(() => (
    <ToolErrorContext.Provider value={() => 'failed'}>
      <createBookingLinkHandler.render {...context} />
    </ToolErrorContext.Provider>
  ));
  expect(view.queryByRole('textbox')).toBeNull();
  expect(view.queryByText('Editable booking review')).toBeNull();
  expect(view.getByText('Create booking link')).toBeTruthy();
});
it('shows the actual saved URL and paused state after execution', () => {
  const view = render(() => (
    <createBookingLinkHandler.render
      {...context}
      response={{
        id: 'booking-call',
        name: 'CreateBookingLink',
        data: {
          profileId: crypto.randomUUID(),
          eventTypeId: crypto.randomUUID(),
          revision: 1,
          draft,
          url: 'https://macro.com/app/book/profile/intro',
        },
      }}
    />
  ));
  expect(view.getByRole('link', { name: 'Intro' }).getAttribute('href')).toBe(
    'https://macro.com/app/book/profile/intro'
  );
  expect(view.getByText(/Paused/)).toBeTruthy();
});

it('keeps historical booking results readable without inventing confirmation', () => {
  const { id: _eventId, scheduleId: _scheduleId, ...event } = draft.event;
  const { id: _id, ...schedule } = {
    ...draft.schedule,
    weekly: draft.schedule.weekly.map(({ day, windows }) => ({ day, windows })),
  };
  const oldDraft = { event, schedule };
  const call = deserializeToolCall({
    id: 'old',
    name: 'CreateBookingLink',
    json: { draft: oldDraft },
  });
  expect(call.isOk()).toBe(true);
  if (call.isOk() && call.value.name === 'CreateBookingLink') {
    expect(call.value.data).toMatchObject({ userConfirmation: '' });
  }
  const saved = {
    profileId: crypto.randomUUID(),
    eventTypeId: crypto.randomUUID(),
    revision: 1,
    draft: oldDraft,
    url: 'https://macro.com/app/book/profile/intro',
  };
  const response = deserializeToolResponse({
    id: 'old',
    name: 'CreateBookingLink',
    json: { UserAction: saved },
  });
  expect(response.isOk()).toBe(true);
  if (response.isOk()) expect(response.value.data).toEqual(saved);
});

it('ignores draft-only time-off annotations when parsing booking settings', () => {
  const profile = {
    id: crypto.randomUUID(),
    name: 'Booking page',
    description: '',
    revision: 1,
    eventTypes: [],
    schedules: [
      {
        ...schedule,
        weekly: [
          { day: 0, windows: [], unavailableWindows: [] },
          {
            day: 1,
            windows: [],
            unavailableWindows: [{ start: '09:00', end: '17:00' }],
          },
          { day: 2, windows: [], unavailableWindows: null },
          { day: 3, windows: [] },
        ],
        overrides: [
          { date: '2026-10-20', windows: [], unavailableWindows: [] },
          {
            date: '2026-10-21',
            windows: [],
            unavailableWindows: [{ start: '09:00', end: '17:00' }],
          },
          { date: '2026-10-22', windows: [], unavailableWindows: null },
          { date: '2026-10-23', windows: [] },
        ],
      },
    ],
  };
  const savedProfile = schedulingProfileForSave(profile);
  const call = deserializeToolCall({
    id: 'update-settings',
    name: 'UpdateBookingSettings',
    json: { profile, userConfirmation: 'Save these hours.' },
  });
  expect(call.isOk()).toBe(true);
  if (call.isOk())
    expect(call.value.data).toEqual({
      profile: savedProfile,
      userConfirmation: 'Save these hours.',
    });
  const response = deserializeToolResponse({
    id: 'read-settings',
    name: 'ReadBookingSettings',
    json: { profile, pageUrl: 'https://macro.com/app/book/profile' },
  });
  expect(response.isOk()).toBe(true);
  if (response.isOk())
    expect(response.value.data).toMatchObject({ profile: savedProfile });
});
