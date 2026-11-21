import { t } from '@app/lib/i18n';
import { catchToResult, throwOnErr } from '@core/util/result';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  assertQueryAccount,
  captureQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { useItemRawName } from '@queries/preview';
import { createGraphqlItemPreviewQuery } from '@queries/preview/graphql';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type { crmEmailPolicyClient } from '@service-storage/crm-email-policy';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, onCleanup } from 'solid-js';
import type {
  EmailPolicyCommand,
  EmailPolicySource,
} from '../context/email-policy';
import type { CrmQueryDependencies } from './dependencies';
import { crmKeys } from './keys';

type Dependencies = Pick<CrmQueryDependencies, 'client' | 'feedback'> & {
  policy: typeof crmEmailPolicyClient;
};

export function createThreadRuleName(
  threadId: string
): Accessor<string | undefined> {
  // A missing label must not fall back to fetching a full email thread.
  const query = createGraphqlItemPreviewQuery(
    () => ({ id: threadId, type: 'email' }),
    false
  );
  return () => {
    const preview = query.data();
    return preview && isAccessiblePreviewItem(preview)
      ? preview.rawName
      : undefined;
  };
}

function scopeKey(
  account: QueryAccount | undefined,
  teamId: string | undefined
) {
  return account && teamId
    ? JSON.stringify([account.userId, account.session, teamId])
    : undefined;
}

function policyOptions(
  deps: Dependencies,
  account: QueryAccount | undefined,
  teamId: string | undefined
) {
  return queryOptions({
    queryKey: crmKeys.emailPolicy(scopeKey(account, teamId)).queryKey,
    enabled: !!account && !!teamId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      assertQueryAccount(account);
      const value = await throwOnErr(() => deps.policy.get(signal));
      signal.throwIfAborted();
      assertQueryAccount(account);
      return value;
    },
  });
}

function previewOptions(
  deps: Dependencies,
  account: QueryAccount | undefined,
  scope: string | undefined,
  active: boolean
) {
  return queryOptions({
    queryKey: crmKeys.emailPolicyPreview(scope).queryKey,
    enabled: !!account && !!scope && active,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      assertQueryAccount(account);
      const value = await throwOnErr(() => deps.policy.preview(signal));
      signal.throwIfAborted();
      assertQueryAccount(account);
      return value;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return active &&
        !query.state.error &&
        (status === 'pending' || status === 'running')
        ? 2000
        : false;
    },
  });
}

function historyOptions(
  deps: Dependencies,
  account: QueryAccount | undefined,
  scope: string | undefined,
  before?: string
) {
  return queryOptions({
    queryKey: crmKeys.emailPolicyHistory(scope, before).queryKey,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      assertQueryAccount(account);
      const value = await throwOnErr(() => deps.policy.history(before, signal));
      signal.throwIfAborted();
      assertQueryAccount(account);
      return value;
    },
  });
}

function revisionOptions(
  deps: Dependencies,
  account: QueryAccount | undefined,
  scope: string | undefined,
  revision: number
) {
  return queryOptions({
    queryKey: crmKeys.emailPolicyRevision(scope, revision).queryKey,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      assertQueryAccount(account);
      const value = await throwOnErr(() =>
        deps.policy.revision(revision, signal)
      );
      signal.throwIfAborted();
      assertQueryAccount(account);
      return value;
    },
  });
}

export function createEmailPolicySource(
  deps: Dependencies,
  teamId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>
): EmailPolicySource {
  const account = () => captureQueryAccount(userId());
  const scope = () => scopeKey(account(), teamId());
  const abort = new AbortController();
  onCleanup(() => abort.abort());
  const query = useQuery(
    () => policyOptions(deps, account(), teamId()),
    () => deps.client
  );
  const change = useMutation(
    () => ({
      retry: false,
      mutationFn: ({
        command,
        parent,
      }: {
        command: EmailPolicyCommand;
        parent: TraceContext;
      }) =>
        parent.run(() =>
          Telemetry.span('crm.email_policy.change', async (span) => {
            const owner = account();
            const ownerScope = scope();
            assertQueryAccount(owner);
            abort.signal.throwIfAborted();
            span.setAttr('crm.policy.action', command.change.action);
            const result = await throwOnErr(() => deps.policy.replace(command));
            // A saved operation stays successful even if refreshing a reader fails.
            // Never publish its result or feedback into a replacement account/team.
            if (ownerScope !== scope() || abort.signal.aborted) return result;
            assertQueryAccount(owner);
            await deps.client.cancelQueries({
              queryKey: crmKeys.emailPolicy(ownerScope).queryKey,
            });
            const refreshes = await Promise.allSettled([
              deps.client.invalidateQueries(
                { queryKey: crmKeys._def },
                { throwOnError: true }
              ),
              deps.client.invalidateQueries(
                { queryKey: soupKeys._def },
                { throwOnError: true }
              ),
              span.run(() =>
                refreshActiveGraphqlSoupQueries({
                  where: (body) =>
                    typeof body === 'object' &&
                    body !== null &&
                    ('ecd' in body || 'eca' in body || 'crma' in body),
                  throwOnError: true,
                })
              ),
            ]);
            if (
              ownerScope === scope() &&
              !abort.signal.aborted &&
              refreshes.some((r) => r.status === 'rejected')
            ) {
              span.error('CRM email policy refresh failed');
              deps.feedback.failure(t('crm.privacyRefreshFailed'));
            }
            return result;
          })
        ),
    }),
    () => deps.client
  );

  return {
    scope,
    query,
    createRuleName: (rule) => {
      const ownerScope = scope();
      const item =
        rule.kind === 'contact'
          ? { id: rule.contact_id, type: 'crm_contact' as const }
          : rule.kind === 'company'
            ? { id: rule.company_id, type: 'crm_company' as const }
            : rule.kind === 'thread'
              ? { id: rule.thread_id, type: 'email' as const }
              : undefined;
      if (!item) return () => undefined;
      const name =
        item.type === 'email'
          ? createThreadRuleName(item.id)
          : useItemRawName(() => item);
      return () =>
        ownerScope === scope() && !abort.signal.aborted ? name() : undefined;
    },
    createPreview: (active) =>
      useQuery(
        () => previewOptions(deps, account(), scope(), active()),
        () => deps.client
      ),
    read: () =>
      catchToResult(() =>
        deps.client.fetchQuery(policyOptions(deps, account(), teamId()))
      ),
    validate: (json) =>
      catchToResult(async () => {
        assertQueryAccount(account());
        return throwOnErr(() => deps.policy.validate(json, abort.signal));
      }),
    change: (command) => {
      const parent = Telemetry.captureContext();
      return catchToResult(() => change.mutateAsync({ command, parent }));
    },
    preview: () =>
      catchToResult(() =>
        deps.client.fetchQuery(previewOptions(deps, account(), scope(), true))
      ),
    startPreview: (input) =>
      catchToResult(async () => {
        const ownerScope = scope();
        const generation = cacheSessionGeneration.capture();
        assertQueryAccount(account());
        const value = await throwOnErr(() =>
          Telemetry.span('crm.email_policy.preview', () =>
            deps.policy.startPreview(input, abort.signal)
          )
        );
        if (
          ownerScope === scope() &&
          !abort.signal.aborted &&
          cacheSessionGeneration.isCurrent(generation)
        ) {
          await deps.client.cancelQueries({
            queryKey: crmKeys.emailPolicyPreview(ownerScope).queryKey,
          });
          if (
            ownerScope === scope() &&
            !abort.signal.aborted &&
            cacheSessionGeneration.isCurrent(generation)
          )
            deps.client.setQueryData(
              crmKeys.emailPolicyPreview(ownerScope).queryKey,
              value
            );
        }
        return value;
      }),
    cancelPreview: (id) =>
      catchToResult(async () => {
        assertQueryAccount(account());
        return throwOnErr(() => deps.policy.cancelPreview(id, abort.signal));
      }),
    history: (before) =>
      catchToResult(() =>
        deps.client.fetchQuery(historyOptions(deps, account(), scope(), before))
      ),
    revision: (revision) =>
      catchToResult(() =>
        deps.client.fetchQuery(
          revisionOptions(deps, account(), scope(), revision)
        )
      ),
  };
}
