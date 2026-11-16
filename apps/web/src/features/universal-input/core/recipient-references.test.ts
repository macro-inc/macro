import { expect, it } from 'vitest';
import { applySuggestions, fieldsSchema } from './input';
import { inputPeopleTerms } from './people-terms';
import {
  messageRecipientChoices,
  type Recipient,
  recipientTerms,
  resolveRecipientTerms,
} from './recipients';
import { resolveSearchFilters } from './search';

it('requires complete per-label evidence and preserves preferred-full-name ambiguity rules', () => {
  const full: Recipient = {
    id: 'macro|full@example.com',
    email: 'full@example.com',
    label: 'Shared',
    kind: 'user',
  };
  const first: Recipient = {
    id: 'macro|first@example.com',
    email: 'first@example.com',
    label: 'Shared Person',
    kind: 'user',
  };
  expect(resolveRecipientTerms(['Shared'], () => undefined, false)).toEqual({
    recipients: [],
    unresolved: ['Shared'],
  });
  expect(
    resolveRecipientTerms(['Shared'], () => [full, first], false).recipients
  ).toEqual([full]);
  expect(
    resolveRecipientTerms(
      ['Shared'],
      () => [first, { ...full, label: 'Shared Other' }],
      false
    ).unresolved
  ).toEqual(['Shared']);
  expect(
    resolveRecipientTerms(
      ['Person, One'],
      () => [{ ...full, label: 'Person, One' }],
      false
    ).recipients
  ).toHaveLength(1);
});

it('never redirects a complete address or user ID through a display-name alias', () => {
  const alias: Recipient = {
    id: 'macro|other@example.com',
    email: 'other@example.com',
    label: 'target@example.com',
    kind: 'user',
  };
  const expected = {
    id: 'target@example.com',
    email: 'TARGET@example.com',
    label: 'TARGET@example.com',
    kind: 'user',
    external: true,
  };
  expect(
    resolveRecipientTerms(['TARGET@example.com'], [alias], true).recipients
  ).toEqual([expected]);
  expect(
    resolveRecipientTerms(['TARGET@example.com'], () => undefined, true)
      .recipients
  ).toEqual([expected]);
  expect(
    resolveRecipientTerms(['TARGET@example.com'], [alias], false).unresolved
  ).toEqual(['TARGET@example.com']);
  expect(
    resolveRecipientTerms(
      ['macro|target@example.com'],
      [{ ...alias, label: 'macro|target@example.com' }],
      true
    ).unresolved
  ).toEqual(['macro|target@example.com']);
  expect(
    resolveRecipientTerms(
      ['target@example.com', 'TARGET@example.com'],
      [],
      true
    ).recipients
  ).toHaveLength(1);
});

it('preserves model boundaries through string fields without changing manual separators', () => {
  const fields = fieldsSchema.parse(
    applySuggestions({}, [], {
      recipients: ['Family, Given'],
      cc: ['One; Two'],
      bcc: ['Three\nFour'],
      guests: ['Family, Given', 'Other'],
    })
  );
  expect(inputPeopleTerms(fields, 'email')).toEqual([
    'family, given',
    'one; two',
    'three four',
  ]);
  expect(inputPeopleTerms(fields, 'calendar')).toEqual([
    'family, given',
    'other',
  ]);
  expect(inputPeopleTerms(fields, 'message')).toEqual(['family, given']);
  expect(recipientTerms('One, Two; Three\nFour')).toEqual([
    'One',
    'Two',
    'Three',
    'Four',
  ]);
  expect(recipientTerms('[unfinished')).toEqual(['[unfinished']);
});

it('preserves an address local-part sigil instead of treating it as a channel prefix', () => {
  const other: Recipient = {
    id: 'macro|target@example.com',
    email: 'target@example.com',
    label: 'Other',
    kind: 'user',
  };
  expect(
    resolveRecipientTerms(['#target@example.com'], [other], true).recipients
  ).toEqual([
    {
      id: '#target@example.com',
      email: '#target@example.com',
      label: '#target@example.com',
      kind: 'user',
      external: true,
    },
  ]);
  expect(
    inputPeopleTerms(
      fieldsSchema.parse({ recipients: '#target@example.com' }),
      'email'
    )
  ).toEqual(['#target@example.com']);
});

it('resolves explicit channel IDs while people are unavailable but does not guess channel names', () => {
  const channel: Recipient = {
    id: 'channel-id',
    label: 'Shared',
    kind: 'channel',
  };
  const pending = (term: string) =>
    messageRecipientChoices(term, () => undefined, [channel]);
  expect(
    resolveRecipientTerms(['channel-id'], pending, false).recipients
  ).toEqual([channel]);
  expect(resolveRecipientTerms(['Shared'], pending, false).unresolved).toEqual([
    'Shared',
  ]);
  const person: Recipient = {
    id: 'macro|person@example.com',
    label: 'Shared',
    email: 'person@example.com',
    kind: 'user',
  };
  expect(
    resolveRecipientTerms(
      ['Shared'],
      (term) => messageRecipientChoices(term, () => [person], [channel]),
      false
    ).unresolved
  ).toEqual(['Shared']);
});

it('requests only current mode fields and preserves structured search term boundaries', () => {
  const fields = fieldsSchema.parse({
    recipients: '@Person One; person@example.com',
    cc: 'Another Person',
    guests: 'Guest Person',
    searchFilters: JSON.stringify({
      type: 'task',
      task: {
        status: [],
        priority: [],
        assignees: ['Person, One'],
        createdBy: ['Other Person'],
      },
    }),
  });
  expect(inputPeopleTerms(fields, 'email')).toEqual([
    'person one',
    'person@example.com',
    'another person',
  ]);
  expect(inputPeopleTerms(fields, 'message')).toEqual([
    'person one',
    'person@example.com',
  ]);
  expect(inputPeopleTerms(fields, 'calendar')).toEqual(['guest person']);
  expect(inputPeopleTerms(fields, 'search')).toEqual([
    'person, one',
    'other person',
  ]);
  expect(inputPeopleTerms(fields, 'ai')).toEqual([]);
  expect(inputPeopleTerms(fields, 'task')).toEqual([]);
  const search = resolveSearchFilters(
    fields.searchFilters,
    () => undefined,
    []
  );
  expect(search.unresolved).toEqual(['Person, One', 'Other Person']);
  expect(search.state.task.assignees).toEqual(['Person, One']);
});
