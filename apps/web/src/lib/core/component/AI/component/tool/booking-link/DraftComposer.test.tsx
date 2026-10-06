import { newEventType, newSchedule } from '@app/features/scheduling/core/types';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingDraftComposer } from './DraftComposer';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|host@example.test',
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isSuccess: false, isError: false }),
}));
vi.mock('@app/features/scheduling/queries/source', () => ({
  useSchedulingProfileQuery: () => ({ isSuccess: false, isError: false }),
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: (id: string) => id,
  macroIdToEmail: (id: string) => id,
}));
afterEach(cleanup);
it.each([undefined, '019a19f7-2a01-7c21-809e-fc6bfb9ef327'])(
  'renders without treating unknown team membership as removal: %s',
  (teamId) => {
    const schedule = newSchedule('UTC');
    const event = {
      ...newEventType(schedule.id, ['macro|host@example.test'], !!teamId),
      title: 'Intro',
      slug: 'intro',
    };
    const view = render(() => (
      <BookingDraftComposer
        initialData={{ teamId, draft: { event, schedule } }}
        sink={{
          canAct: () => true,
          lockedNotice: () => undefined,
          onExecute: async () => true,
          onReject: async () => true,
        }}
      />
    ));
    expect(view.getByLabelText('Title')).toBeTruthy();
    expect(view.queryByText('Former team member')).toBeNull();
    expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  }
);
