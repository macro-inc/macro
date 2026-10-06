import { newEventType, newSchedule } from '@app/features/scheduling/core/types';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { createBookingLinkHandler } from './BookingLinks';
import { ToolErrorContext } from './ToolRenderer';

vi.mock('./booking-link/ChatCompose', () => ({
  BookingChatCompose: () => <div>Editable booking review</div>,
}));
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
    data: { draft },
  },
  chat_id: 'chat',
  message_id: 'message',
  part_index: 0,
  isComplete: true,
  renderContext: { isStreaming: false, followedBy: () => false },
};
it('restores the editable review when a failed persisted response is remounted', () => {
  const view = render(() => (
    <ToolErrorContext.Provider value={() => 'failed'}>
      <createBookingLinkHandler.render {...context} />
    </ToolErrorContext.Provider>
  ));
  expect(view.getByText('Editable booking review')).toBeTruthy();
  expect(
    view.getByText('The previous save failed. Review your draft and try again.')
  ).toBeTruthy();
});
it('shows the actual saved URL and paused state after execution', () => {
  const view = render(() => (
    <createBookingLinkHandler.render
      {...context}
      response={{
        id: 'booking-call',
        name: 'CreateBookingLink',
        data: {
          UserAction: {
            profileId: crypto.randomUUID(),
            eventTypeId: crypto.randomUUID(),
            revision: 1,
            draft,
            url: 'https://macro.com/app/book/profile/intro',
          },
        },
      }}
    />
  ));
  expect(view.getByRole('link', { name: 'Intro' }).getAttribute('href')).toBe(
    'https://macro.com/app/book/profile/intro'
  );
  expect(view.getByText(/Paused/)).toBeTruthy();
});
