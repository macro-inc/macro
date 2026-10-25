import { afterEach, expect, test } from 'bun:test';
import type { CalendarOccurrence } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const occurrence: CalendarOccurrence = {
  eventId: 'event-1',
  occurrenceKey: '2026-10-23T14:00:00+00:00',
  isCancelled: false,
  time: {
    kind: 'timed',
    startsAt: '2026-10-23T14:00:00Z',
    endsAt: '2026-10-23T15:00:00Z',
  },
};

function recordingMacro() {
  const requests: Request[] = [];
  let teamId: string | null = null;
  let linked = false;
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    if (new URL(request.url).pathname === '/meeting-notes/documents') {
      return Response.json({
        documents: [{ documentId: 'note-1', name: 'Design notes' }],
        teams: [{ id: 'team-1', name: 'Design' }],
      });
    }
    if (request.method === 'PUT') {
      const body = await request.clone().json();
      teamId = body.teamId;
      linked = true;
      return new Response(null, { status: 204 });
    }
    if (request.method === 'DELETE') {
      linked = false;
      return new Response(null, { status: 204 });
    }
    return Response.json(
      linked
        ? [
            {
              documentId: 'note-1',
              name: 'Design notes',
              canManage: true,
              team: teamId ? { id: teamId, name: 'Design' } : null,
            },
          ]
        : [],
    );
  }) as typeof fetch;
  return {
    requests,
    macro: new Macro({
      env: 'dev',
      token: 'test-token',
      hosts: { calendar: 'https://calendar.example.test' },
    }),
  };
}

test('meeting notes use occurrence-scoped handles and explicit optional team grants', async () => {
  const { macro, requests } = recordingMacro();
  const picker = await macro.calendar.noteDocuments('Design');
  const document = picker.documents[0].document;
  const team = picker.teams[0].team;
  expect(document.id).toBe('note-1');
  const event = macro.calendar.event(occurrence.eventId);
  const note = await event.linkNote(document, occurrence);
  expect(await requests[1].clone().json()).toEqual({ teamId: null });
  expect(new URL(requests[1].url).searchParams.get('occurrenceKey')).toBe(
    occurrence.occurrenceKey,
  );
  expect(await note.team()).toBeUndefined();
  await note.setTeam(team);
  expect((await note.team())?.id).toBe('team-1');
  await note.setTeam();
  expect(await note.team()).toBeUndefined();
  const listed = await event.notes(occurrence);
  expect((await listed[0].document()).id).toBe(document.id);
  const beforeSeededRead = requests.length;
  expect(await listed[0].name()).toBe('Design notes');
  expect(requests).toHaveLength(beforeSeededRead);
  await note.unlink();
  expect(await event.notes(occurrence)).toEqual([]);
  expect(
    requests
      .filter((request) => request.method === 'DELETE')
      .map((request) => new URL(request.url).pathname),
  ).toEqual(['/events/event-1/notes/note-1']);
});

test('a mismatched occurrence cannot share a document or issue a request', async () => {
  const { macro, requests } = recordingMacro();
  await expect(
    macro.calendar
      .event('different-event')
      .linkNote(macro.documents.byId('note-1'), occurrence),
  ).rejects.toThrow('different event');
  expect(requests).toHaveLength(0);
});

test('a document owner can discover and revoke an unavailable meeting grant', async () => {
  const { macro } = recordingMacro();
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json([
      {
        eventId: occurrence.eventId,
        occurrenceKey: occurrence.occurrenceKey,
        eventTitle: 'Unavailable meeting',
        documentName: 'Design notes',
        team: { id: 'team-1', name: 'Design' },
      },
    ]);
  }) as typeof fetch;
  const links = await macro.documents.byId('note-1').meetingNotes();
  expect(links[0].eventTitle).toBe('Unavailable meeting');
  expect((await links[0].note.team())?.id).toBe('team-1');
  await links[0].note.unlink();
  expect(new URL(requests[1].url).pathname).toBe(
    '/events/event-1/notes/note-1',
  );
  expect(new URL(requests[1].url).searchParams.get('occurrenceKey')).toBe(
    occurrence.occurrenceKey,
  );
});

test('a rejected share surfaces the error without retrying or granting team access', async () => {
  const { macro, requests } = recordingMacro();
  const event = macro.calendar.event(occurrence.eventId);
  const note = await event.linkNote(macro.documents.byId('note-1'), occurrence);
  expect(await note.team()).toBeUndefined();
  let attempts = 0;
  globalThis.fetch = (async (_input) => {
    attempts++;
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }) as typeof fetch;
  await expect(note.setTeam(macro.teams.byId('team-1'))).rejects.toThrow();
  expect(attempts).toBe(1);
  expect(await note.team()).toBeUndefined();
  expect(requests).toHaveLength(2);
});
