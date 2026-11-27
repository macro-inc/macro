import { ApiLabelType } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  toEmailSearchLabels,
  toEmailSearchPeople,
} from './use-email-search-values';

const user = (id: string, email: string, name?: string | null) => ({
  id,
  data: { email, name },
});

describe('toEmailSearchPeople', () => {
  it('keeps the order, lists each address once and only those mail can reach', () => {
    expect(
      toEmailSearchPeople([
        user('u1', 'Ana@Example.com', 'Ana Lopez'),
        user('u2', 'ana@example.com', 'Ana again'),
        user('u3', 'ada-246c21@agents.macro.invalid', 'Ada'),
        user('u4', 'bo@example.com', 'bo@example.com'),
        user('u5', 'cy@example.com', null),
      ])
    ).toEqual([
      { id: 'u1', email: 'ana@example.com', name: 'Ana Lopez' },
      { id: 'u4', email: 'bo@example.com', name: undefined },
      { id: 'u5', email: 'cy@example.com', name: undefined },
    ]);
  });
});

describe('toEmailSearchLabels', () => {
  it('lists tags, then the inboxes’ own labels, leaving out system labels', () => {
    expect(
      toEmailSearchLabels(
        [{ label: 'Clients' }],
        [
          { name: 'INBOX', type: ApiLabelType.System },
          { name: 'Travel', type: ApiLabelType.User },
        ]
      )
    ).toEqual([
      { name: 'Clients', kind: 'tag' },
      { name: 'Travel', kind: 'label' },
    ]);
  });
});
