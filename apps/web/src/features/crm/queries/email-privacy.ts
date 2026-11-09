import { t } from '@app/lib/i18n';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type {
  CrmEmailPrivacyResponse,
  crmEmailPrivacyClient,
} from '@service-storage/crm-email-privacy';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { EmailPrivacy, EmailPrivacyChange } from '../core/email-privacy';
import type { CrmQueryDependencies } from './dependencies';
import { crmKeys } from './keys';

function fromResponse(data: CrmEmailPrivacyResponse): EmailPrivacy {
  return {
    enabled: data.enabled,
    mailboxEmail: data.mailbox_email ?? null,
    mailboxLinkId: data.mailbox_link_id ?? null,
    teamDomains: data.team_domains,
    personalDomains: data.personal_domains,
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

export function createEmailPrivacySource(
  deps: EmailPrivacyDependencies,
  teamId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>
) {
  const key = () => crmKeys.emailPrivacy(teamId(), userId()).queryKey;
  const query = useQuery(
    () => emailPrivacyOptions(deps, teamId(), userId()),
    () => deps.client
  );
  const update = useMutation(
    () => ({
      scope: { id: 'crm-email-privacy' },
      mutationFn: (change: EmailPrivacyChange) =>
        Telemetry.span('crm.email_privacy.change', async (span) => {
          const queryKey = key();
          span.setAttr('crm.privacy.action', change.action);
          if (change.action !== 'set_consent') {
            span.setAttr('crm.privacy.scope', change.scope);
          }
          try {
            const data = fromResponse(
              await throwOnErr(() => deps.privacy.update(change))
            );
            // The response belongs to the identity that started this request.
            // Never replace another account's settings after an account switch.
            deps.client.setQueryData(queryKey, data);
            await span.span('crm.email_privacy.refresh', async (refresh) => {
              try {
                // Consent is server-derived; normalized lists also need a
                // server read after this mutation changes their eligibility.
                await refreshActiveGraphqlSoupQueries({
                  where: (body) =>
                    typeof body === 'object' &&
                    body !== null &&
                    ('ecd' in body || 'eca' in body || 'crma' in body),
                  throwOnError: true,
                });
                await deps.client.invalidateQueries({
                  queryKey: soupKeys._def,
                });
                await deps.client.invalidateQueries({ queryKey: crmKeys._def });
              } catch (error) {
                refresh.error('CRM email privacy refresh failed');
                throw error;
              }
            });
            return data;
          } catch (error) {
            span.error('CRM email privacy update failed');
            throw error;
          }
        }),
      onError: (error: Error) =>
        deps.feedback.failure(error.message || t('crm.privacyUpdateFailed')),
    }),
    () => deps.client
  );
  return { query, update };
}
