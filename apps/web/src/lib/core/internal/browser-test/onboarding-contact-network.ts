import { contactRecordKey } from '@queries/contacts/contact-key';
import type { ContactDirectoryPageQueryVariables } from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';

export const [teamContactRequests, setTeamContactRequests] = createSignal<
  ContactDirectoryPageQueryVariables[]
>([]);
let gate: PromiseWithResolvers<void> | undefined;
export function holdTeamContacts() {
  gate ??= Promise.withResolvers<void>();
}
export function releaseTeamContacts() {
  gate?.resolve();
  gate = undefined;
}
export async function fetchTeamContactPage(
  variables: ContactDirectoryPageQueryVariables,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  setTeamContactRequests((requests) => [...requests, variables]);
  if (gate) await gate.promise;
  signal.throwIfAborted();
  const viewer = 'macro|viewer@example.com';
  const domain = (variables.search ?? '').replace(/^@/, '');
  const page = Number(variables.after ?? 0);
  const emails = [
    `viewer@${domain}`,
    'alias@other.example.com',
    ...Array.from({ length: 20 }, (_, i) => `member${i}@${domain}`),
  ];
  return {
    user: {
      id: viewer,
      contacts: {
        nodes:
          page < 5
            ? []
            : emails.map((email) => ({
                userId: `macro|${email}`,
                email,
                name: `Person at ${domain}`,
                id: contactRecordKey(viewer, `macro|${email}`).slice(
                  'GraphqlContact:'.length
                ),
              })),
        nextCursor: String(page + 1),
      },
    },
  };
}
