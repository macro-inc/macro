import { queryClient } from '@queries/client';
import { calendarNotesClient } from '@service-calendar/notes';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentMeetingNotes } from './document-meeting-notes';
import { notesKeys } from './queries/keys';

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'owner' }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isPending: false, isError: false, data: null }),
}));
vi.mock('@core/util/create', () => ({ createMarkdownFile: vi.fn() }));
vi.mock('@service-calendar/notes', () => ({
  calendarNotesClient: { documentLinks: vi.fn() },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.resetAllMocks();
});

it('retains cached links after a failed refresh without reporting their grants as confirmed', async () => {
  vi.mocked(calendarNotesClient.documentLinks).mockResolvedValue(
    ok([
      {
        documentName: 'Notes',
        eventId: 'event',
        eventTitle: 'Planning',
        occurrenceKey: 'single',
        canViewMeeting: true,
        team: { id: 'team', name: 'Macro' },
      },
    ])
  );
  const onAccessState = vi.fn();
  render(() => (
    <QueryClientProvider client={queryClient}>
      <DocumentMeetingNotes documentId="note" onAccessState={onAccessState} />
    </QueryClientProvider>
  ));
  await vi.waitFor(() =>
    expect(onAccessState).toHaveBeenLastCalledWith('shared', ['team'])
  );
  const unlink = screen.getByRole('button', { name: 'Unlink' });
  vi.mocked(calendarNotesClient.documentLinks).mockResolvedValue(
    err([{ code: 'NETWORK_ERROR', message: 'Network unavailable' }])
  );
  await queryClient.refetchQueries({
    queryKey: notesKeys.documentLinks('owner', 'note').queryKey,
  });
  await vi.waitFor(() =>
    expect(onAccessState).toHaveBeenLastCalledWith('error', [])
  );
  expect(screen.getByRole('button', { name: 'Unlink' })).toBe(unlink);
});
