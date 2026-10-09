import { describe, expect, it } from 'vitest';
import {
  applySuggestions,
  fieldsSchema,
  type Intent,
  inferIntent,
  missingFields,
} from './input';
import { resolveRecipients } from './recipients';

describe('inference decisions', () => {
  it('requires a high score and a clear margin without normalizing independent scores', () => {
    expect(
      inferIntent([
        { intent: 'task', score: 0.8 },
        { intent: 'note', score: 0.6 },
      ])
    ).toBe('task');
    expect(inferIntent([{ intent: 'task', score: 0.79 }])).toBeUndefined();
    expect(
      inferIntent([
        { intent: 'task', score: 0.95 },
        { intent: 'calendar', score: 0.9 },
      ])
    ).toBeUndefined();
  });
  it('clears old machine suggestions but preserves manually cleared fields', () => {
    expect(
      applySuggestions({ subject: 'old', title: '' }, ['title'], {
        subject: null,
        title: 'new',
        recipients: [],
        guests: [],
      })
    ).toMatchObject({ subject: '', title: '' });
  });
  it.each<Intent>([
    'ai',
    'search',
    'email',
    'note',
    'task',
    'calendar',
    'message',
  ])('accepts a complete %s snapshot', (intent) => {
    expect(
      missingFields({
        intent,
        id: 'id',
        text: 'Some content',
        fields: fieldsSchema.parse({
          title: 'Title',
          recipients: 'john@example.com',
          body: 'Hello',
          subject: 'Subject',
          start: '2026-10-10T15:00',
          end: '2026-10-10T16:00',
        }),
      })
    ).toBeUndefined();
  });
  it('rejects an event ending before it starts', () => {
    expect(
      missingFields({
        intent: 'calendar',
        id: 'id',
        text: 'Call',
        fields: fieldsSchema.parse({
          title: 'Call',
          start: '2026-10-10T15:00',
          end: '2026-10-10T14:00',
        }),
      })
    ).toContain('valid start');
  });
});

describe('recipient matching', () => {
  const people = [
    {
      id: 'john-a',
      label: 'John Adams',
      email: 'john.a@example.com',
      kind: 'user' as const,
    },
    {
      id: 'john-b',
      label: 'John Baker',
      email: 'john.b@example.com',
      kind: 'user' as const,
    },
  ];
  it('requires a choice for ambiguous first names', () => {
    expect(resolveRecipients('John', people, true).unresolved).toEqual([
      'John',
    ]);
  });
  it('resolves a unique first name and exact addresses', () => {
    expect(
      resolveRecipients('John', people.slice(0, 1), false).recipients
    ).toEqual(people.slice(0, 1));
    expect(
      resolveRecipients('john.b@example.com', people, true).recipients
    ).toEqual(people.slice(1));
  });
  it('accepts external email addresses only for email/invites', () => {
    expect(
      resolveRecipients('external@example.com', [], true).recipients
    ).toHaveLength(1);
    expect(
      resolveRecipients('external@example.com', [], false).unresolved
    ).toHaveLength(1);
  });
});
