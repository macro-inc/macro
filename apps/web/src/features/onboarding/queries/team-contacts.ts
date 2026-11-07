import { Telemetry } from '@macro-inc/observability';
import {
  assertQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { useQueryAccount } from '@queries/auth/use-query-account';
import {
  CONTACT_WINDOW_SIZE,
  type ContactDirectoryCursor,
  readContactDirectory,
} from '@queries/contacts/directory';
import type { ContactWindowHost } from '@queries/contacts/directory-query';
import { createContactQueryEpoch } from '@queries/contacts/query-epoch';
import { useContactDirectoryScope } from '@queries/contacts/use-directory';
import { queryReadyGate } from '@queries/gate';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo, createUniqueId } from 'solid-js';
import type { Loadable } from '../context/onboarding-context';
import { emailDomain, PREFILL_CAP } from '../core/team';
import { onboardingContactKeys } from './keys';

export async function readTeamContacts(
  viewer: string,
  host: ContactWindowHost | undefined,
  domain: string,
  ownEmail: string | undefined,
  signal: AbortSignal,
  read: typeof readContactDirectory = readContactDirectory
): Promise<string[]> {
  return Telemetry.span('onboarding.team_contacts', async (span) => {
    signal.throwIfAborted();
    const target = domain.trim().toLowerCase();
    if (!target) return [];
    const self = ownEmail?.trim().toLowerCase();
    const emails = new Map<string, string>();
    let cursor: ContactDirectoryCursor | undefined;
    let pages = 0;
    for (;;) {
      signal.throwIfAborted();
      const page = await read(
        viewer,
        host,
        { query: `@${target}`, limit: CONTACT_WINDOW_SIZE, cursor },
        signal
      );
      signal.throwIfAborted();
      span.setAttr('contacts.page_count', ++pages);
      for (const user of page.users) {
        const key = user.email.trim().toLowerCase();
        if (emailDomain(key) !== target || key === self) continue;
        if (!emails.has(key)) emails.set(key, user.email);
        if (emails.size === PREFILL_CAP) {
          span.setAttr('contacts.suggestion_count', emails.size);
          return [...emails.values()];
        }
      }
      if (!page.nextCursor) break;
      if (JSON.stringify(page.nextCursor) === JSON.stringify(cursor))
        throw new Error('Contact prefill did not advance');
      cursor = page.nextCursor;
    }
    span.setAttr('contacts.suggestion_count', emails.size);
    return [...emails.values()];
  });
}

function teammateOptions(
  owner: string,
  account: QueryAccount | undefined,
  host: ContactWindowHost | undefined,
  epoch: number,
  domain: string | undefined,
  ownEmail: string | undefined
) {
  return queryOptions({
    queryKey: onboardingContactKeys.teammates(
      owner,
      account,
      host?.clientId ?? 'network',
      epoch,
      domain,
      ownEmail
    ).queryKey,
    enabled: !!account && !!domain,
    queryFn: async ({ signal }) => {
      assertQueryAccount(account);
      if (!domain) throw new Error('Team suggestions require a domain');
      const emails = await readTeamContacts(
        account.userId,
        host,
        domain,
        ownEmail,
        signal
      );
      assertQueryAccount(account);
      return {
        account,
        hostId: host?.clientId,
        epoch,
        domain,
        ownEmail,
        emails,
      };
    },
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: false,
  });
}

/** A step-owned maximum-six email seed, never a directory or name cache. */
export function useTeamContacts(
  domain: Accessor<string | undefined>,
  ownEmail: Accessor<string | undefined>
) {
  const account = useQueryAccount();
  const directory = useContactDirectoryScope();
  const owner = createUniqueId();
  const { epoch } = createContactQueryEpoch(directory);
  const input = createMemo(() => ({
    domain: domain()?.trim().toLowerCase() || undefined,
    ownEmail: ownEmail()?.trim().toLowerCase(),
  }));
  const query = useQuery(() =>
    teammateOptions(
      owner,
      account(),
      directory().host,
      epoch(),
      input().domain,
      input().ownEmail
    )
  );
  const contacts = (): Loadable<readonly string[]> => {
    const current = input();
    if (!current.domain) return { t: 'ready', value: [] };
    if (!account()) return { t: 'loading' };
    if (query.isError) return { t: 'error' };
    if (!queryReadyGate(query)) return { t: 'loading' };
    const result = query.data;
    if (
      result.account.userId !== account()?.userId ||
      result.account.session !== account()?.session ||
      result.hostId !== directory().host?.clientId ||
      result.epoch !== epoch() ||
      result.domain !== current.domain ||
      result.ownEmail !== current.ownEmail
    )
      return { t: 'loading' };
    return { t: 'ready', value: result.emails };
  };
  return {
    contacts,
    retry: async () => {
      if (input().domain && account())
        await query.refetch({ cancelRefetch: false });
    },
  };
}
