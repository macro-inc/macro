import type { DocumentEntity, EmailEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { mapEmailActivityEntity, mapMyActivityEntity } from './entity-events';

const USER = 'macro|me@test.com';

const HOUR_MS = 60 * 60 * 1000;
const CREATED = new Date('2026-07-01T12:00:00Z');
const at = (offsetMs: number) => new Date(CREATED.getTime() + offsetMs);

function doc(overrides: Partial<DocumentEntity> = {}): DocumentEntity {
  return {
    type: 'document',
    id: 'doc-1',
    name: 'Doc',
    ownerId: USER,
    fileType: 'md',
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  } as DocumentEntity;
}

describe('mapMyActivityEntity — documents', () => {
  it('maps a fresh markdown doc to a single created event', () => {
    const events = mapMyActivityEntity(doc(), USER);
    expect(events.map((e) => e.kind === 'entity-event' && e.verb)).toEqual([
      'created-document',
    ]);
  });

  it('splits an older-edited markdown doc into edited + created events', () => {
    const events = mapMyActivityEntity(
      doc({ updatedAt: at(2 * HOUR_MS) }),
      USER
    );
    expect(events.map((e) => e.kind === 'entity-event' && e.verb)).toEqual([
      'edited-document',
      'created-document',
    ]);
    expect(events[0]!.ts).toBe(at(2 * HOUR_MS).getTime());
    expect(events[1]!.ts).toBe(CREATED.getTime());
    expect(events[0]!.id).not.toBe(events[1]!.id);
  });

  it('maps tasks to task verbs', () => {
    const events = mapMyActivityEntity(
      doc({ subType: { type: 'task' }, updatedAt: at(2 * HOUR_MS) }),
      USER
    );
    expect(events.map((e) => e.kind === 'entity-event' && e.verb)).toEqual([
      'edited-task',
      'created-task',
    ]);
  });

  it('emits nothing for ingested file types like pdf', () => {
    // Email-auto-parsed and uploaded files are pipeline output, and their
    // updatedAt moves when the file is merely viewed — no created/edited
    // events for them.
    expect(mapMyActivityEntity(doc({ fileType: 'pdf' }), USER)).toEqual([]);
    expect(
      mapMyActivityEntity(
        doc({ fileType: 'pdf', updatedAt: at(2 * HOUR_MS) }),
        USER
      )
    ).toEqual([]);
    expect(mapMyActivityEntity(doc({ fileType: undefined }), USER)).toEqual([]);
  });
});

function email(overrides: Partial<EmailEntity> = {}): EmailEntity {
  return {
    type: 'email',
    id: 'thread-1',
    name: 'Subject',
    ownerId: USER,
    isDraft: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  } as EmailEntity;
}

describe('mapMyActivityEntity — emails', () => {
  it('distinguishes drafts from sent email', () => {
    expect(
      mapMyActivityEntity(email(), USER).map(
        (e) => e.kind === 'entity-event' && e.verb
      )
    ).toEqual(['sent-email']);
    expect(
      mapMyActivityEntity(email({ isDraft: true }), USER).map(
        (e) => e.kind === 'entity-event' && e.verb
      )
    ).toEqual(['drafted-email']);
  });
});

describe('mapEmailActivityEntity', () => {
  it('maps signal threads and drops noise and drafts', () => {
    expect(
      mapEmailActivityEntity(email({ isImportant: true })).map(
        (e) => e.kind === 'entity-event' && e.verb
      )
    ).toEqual(['email-activity']);
    // Untriaged rows (importance not loaded) pass through — the server
    // queries already filter on importance.
    expect(mapEmailActivityEntity(email())).toHaveLength(1);
    expect(mapEmailActivityEntity(email({ isImportant: false }))).toEqual([]);
    expect(
      mapEmailActivityEntity(email({ isDraft: true, isImportant: true }))
    ).toEqual([]);
  });
});
