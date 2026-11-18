import { t } from '@app/lib/i18n';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import {
  assertQueryAccount,
  captureQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type {
  CrmEmailConsentResponse,
  CrmEmailPrivacyResponse,
  crmEmailPrivacyClient,
} from '@service-storage/crm-email-privacy';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type {
  EmailConsent,
  EmailPrivacy,
  EmailPrivacyChange,
  ExcludedThreads,
} from '../core/email-privacy';
import type { CrmQueryDependencies } from './dependencies';
import { crmKeys } from './keys';

function consentFromResponse(data: CrmEmailConsentResponse): EmailConsent {
  return {
    enabled: data.enabled,
    mailboxEmail: data.mailbox_email ?? null,
    mailboxLinkId: data.mailbox_link_id ?? null,
  };
}

function fromResponse(data: CrmEmailPrivacyResponse): EmailPrivacy {
  return {
    ...consentFromResponse(data),
    teamDomains: data.team_domains,
    personalDomains: data.personal_domains,
    teamDomainWarnings: data.team_domain_warnings ?? {},
    personalDomainWarnings: data.personal_domain_warnings ?? {},
    canRemoveTeamDomains: data.can_remove_team_domains,
  };
}

type EmailPrivacyDependencies = Pick<
  CrmQueryDependencies,
  'client' | 'feedback'
> & {
  privacy: typeof crmEmailPrivacyClient;
};

function emailPrivacyOptions(
  deps: EmailPrivacyDependencies,
  teamId: string | undefined,
  userId: string | undefined
) {
  return {
    queryKey: crmKeys.emailPrivacy(teamId, userId).queryKey,
    enabled: !!teamId && !!userId,
    queryFn: async () =>
      fromResponse(await throwOnErr(() => deps.privacy.get())),
  };
}

function excludedThreadsOptions(
  deps: EmailPrivacyDependencies,
  teamId: string | undefined,
  account: QueryAccount | undefined,
  after: string | undefined,
  threadId?: string
) {
  return queryOptions({
    queryKey: crmKeys.excludedEmailThreads(
      teamId,
      account?.userId,
      account?.session,
      after,
      threadId
    ).queryKey,
    enabled: !!teamId && !!account,
    queryFn: async ({ signal }): Promise<ExcludedThreads> => {
      signal.throwIfAborted();
      assertQueryAccount(account);
      const data = await throwOnErr(() =>
        deps.privacy.excludedThreads(after, signal, threadId)
      );
      signal.throwIfAborted();
      assertQueryAccount(account);
      return {
        threads: data.threads.map((thread) => ({
          threadId: thread.thread_id,
          linkId: thread.link_id,
          subject: thread.subject ?? null,
        })),
        nextCursor: data.next_cursor ?? null,
      };
    },
  });
}

function emailConsentOptions(
  deps: EmailPrivacyDependencies,
  teamId: string | undefined,
  account: QueryAccount | undefined
) {
  return queryOptions({
    queryKey: crmKeys.emailConsent(teamId, account?.userId, account?.session)
      .queryKey,
    enabled: !!teamId && !!account,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      assertQueryAccount(account);
      const data = await throwOnErr(() => deps.privacy.getConsent(signal));
      signal.throwIfAborted();
      assertQueryAccount(account);
      return consentFromResponse(data);
    },
  });
}

function isContributionEmailRead(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    ('ecd' in body || 'eca' in body)
  );
}

export function createEmailPrivacyMutation(
  deps: EmailPrivacyDependencies,
  teamId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>
) {
  const key = () => crmKeys.emailPrivacy(teamId(), userId()).queryKey;
  return useMutation(
    () => ({
      scope: { id: 'crm-email-privacy' },
      mutationFn: (change: EmailPrivacyChange) =>
        Telemetry.span('crm.email_privacy.change', async (span) => {
          const queryKey = key();
          const account = captureQueryAccount(userId());
          const consentKey = crmKeys.emailConsent(
            teamId(),
            userId(),
            account?.session
          ).queryKey;
          const threadChange = change.action === 'set_thread_exclusion';
          const excludedThreadsKey = [
            ...crmKeys.excludedEmailThreads._def,
            teamId(),
            userId(),
          ];
          span.setAttr('crm.privacy.action', change.action);
          if ('scope' in change) {
            span.setAttr('crm.privacy.scope', change.scope);
          }
          if ('thread_id' in change) {
            span.setAttr('entity.id', change.thread_id);
          }
          let data: EmailPrivacy;
          try {
            data = fromResponse(
              await throwOnErr(() => deps.privacy.update(change))
            );
          } catch (error) {
            span.error('CRM email privacy update failed');
            throw error;
          }
          // The response belongs to the identity that started this request.
          // Never replace another account's settings after an account switch.
          deps.client.setQueryData(queryKey, data);
          if (account) {
            // A consent read started before the write must not replace its
            // confirmed projection after the mutation has completed.
            await deps.client.cancelQueries({
              queryKey: consentKey,
              exact: true,
            });
            deps.client.setQueryData<EmailConsent>(consentKey, {
              enabled: data.enabled,
              mailboxEmail: data.mailboxEmail,
              mailboxLinkId: data.mailboxLinkId,
            });
          }
          if (threadChange) {
            // Invalidation can reuse a pending initial read with no cached data.
            // Abort pre-write reads so every owner page refreshes after the write.
            await deps.client.cancelQueries({ queryKey: excludedThreadsKey });
          }
          await span.span('crm.email_privacy.refresh', async (refresh) => {
            let graphqlFailed = false;
            try {
              // Consent is server-derived; normalized lists also need a
              // server read after this mutation changes their eligibility.
              await refreshActiveGraphqlSoupQueries({
                where: threadChange
                  ? isContributionEmailRead
                  : (body) =>
                      typeof body === 'object' &&
                      body !== null &&
                      ('ecd' in body || 'eca' in body || 'crma' in body),
                throwOnError: true,
              });
            } catch {
              graphqlFailed = true;
            }
            // A failed reader must not prevent other caches from refreshing.
            // Thread changes refresh only contribution readers and owner pages;
            // the PUT response already supplies current settings.
            const invalidations = await Promise.allSettled([
              deps.client.invalidateQueries(
                {
                  queryKey: soupKeys._def,
                  predicate: threadChange
                    ? (query) => query.queryKey.some(isContributionEmailRead)
                    : undefined,
                },
                { throwOnError: true }
              ),
              deps.client.invalidateQueries(
                {
                  queryKey: threadChange ? excludedThreadsKey : crmKeys._def,
                },
                { throwOnError: true }
              ),
            ]);
            if (
              graphqlFailed ||
              invalidations.some((result) => result.status === 'rejected')
            ) {
              refresh.error('CRM email privacy refresh failed');
              deps.feedback.failure(t('crm.privacyRefreshFailed'));
            }
          });
          return data;
        }),
      onError: (error: Error) =>
        deps.feedback.failure(error.message || t('crm.privacyUpdateFailed')),
    }),
    () => deps.client
  );
}

/** Thread controls read only mailbox consent, without loading domain lists. */
export function createEmailConsentQuery(
  deps: EmailPrivacyDependencies,
  teamId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>
) {
  return useQuery(
    () => emailConsentOptions(deps, teamId(), captureQueryAccount(userId())),
    () => deps.client
  );
}

export function createEmailPrivacySource(
  deps: EmailPrivacyDependencies,
  teamId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>
) {
  const query = useQuery(
    () => emailPrivacyOptions(deps, teamId(), userId()),
    () => deps.client
  );
  const update = createEmailPrivacyMutation(deps, teamId, userId);
  const createExcludedThreads = (after: Accessor<string | undefined>) =>
    useQuery(
      () =>
        excludedThreadsOptions(
          deps,
          teamId(),
          captureQueryAccount(userId()),
          after()
        ),
      () => deps.client
    );
  return { query, update, createExcludedThreads };
}

/** The header reads one owner-scoped exclusion, sharing list invalidation. */
export function createThreadExclusionQuery(
  deps: EmailPrivacyDependencies,
  teamId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>,
  threadId: Accessor<string | undefined>
) {
  return useQuery(
    () => ({
      ...excludedThreadsOptions(
        deps,
        teamId(),
        captureQueryAccount(userId()),
        undefined,
        threadId()
      ),
      enabled: !!teamId() && !!captureQueryAccount(userId()) && !!threadId(),
    }),
    () => deps.client
  );
}
