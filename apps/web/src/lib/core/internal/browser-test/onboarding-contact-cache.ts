import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import {
  PEOPLE_POLICY_VERSION,
  type PeopleSearch,
} from '@graphql-cache/people/generated';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { contactRecordKey } from '@queries/contacts/contact-key';
import type { ContactWindowHost } from '@queries/contacts/directory-query';
import { createSignal } from 'solid-js';

export const [teamContactRequests, setTeamContactRequests] = createSignal<
  PeopleSearch[]
>([]);
let gate: PromiseWithResolvers<void> | undefined;
export function holdTeamContacts() {
  gate ??= Promise.withResolvers<void>();
}
export function releaseTeamContacts() {
  gate?.resolve();
  gate = undefined;
}
const viewer = 'macro|viewer@example.com';
export const onboardingCacheHost: ContactWindowHost = {
  ...createNoopCacheHost(),
  disabled: false,
  currentStorageGeneration: async () => '00000000-0000-4000-8000-000000000001',
  readQuery: async () => ({ kind: 'hit', data: { user: { id: viewer } } }),
  people: {
    ...unsupportedContactSync,
    readSql: async () => ({ kind: 'unsupported' }),
    resolveReferences: async () => ({ kind: 'unsupported' }),
    context: async () => ({ kind: 'unsupported' }),
    update: async () => {
      throw new Error('Fixture has no publisher');
    },
    search: async (request) => {
      setTeamContactRequests((requests) => [...requests, request]);
      if (gate) await gate.promise;
      const page = Number(request.cursor ?? 0);
      const emails = [
        'viewer@team.example.com',
        'alias@other.example.com',
        ...['team.example.com', 'changed.example.com'].flatMap((domain) =>
          Array.from({ length: 20 }, (_, i) => `member${i}@${domain}`)
        ),
      ];
      return {
        kind: 'page',
        policyVersion: PEOPLE_POLICY_VERSION,
        truncated: page < 5,
        nextCursor: page < 5 ? String(page + 1) : null,
        people:
          page < 5
            ? []
            : emails.map((email) => ({
                userId: `macro|${email}`,
                recordKey: contactRecordKey(viewer, `macro|${email}`),
                email,
                name: 'Person',
                matchRank: 0,
                score: 0,
                timestampMs: 0,
              })),
      };
    },
  },
};
