import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useQueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  EmailPrivacy,
  EmailPrivacyChange,
} from '../../core/email-privacy';
import { EmailThreadMention } from '../../email-thread-mention';
import { createEmailPolicySource } from '../../queries/email-policy';
import { createEmailPrivacySource } from '../../queries/email-privacy';
import { policyClient } from './policy-adapter';

// Rich mentions import the same optional capabilities as other app references.
export * from '@app/lib/analytics/posthog.tsx';
export * from '@core/context/user.ts';
export * from '@queries/team/teams.ts';
export * from '@service-storage/crm-access-authority.ts';

const params = new URLSearchParams(location.search);
const crmAccess = () => !params.has('no-access');
export const crmAccessAllowed = crmAccess;
export const crmAccessState = () => (crmAccess() ? 'allowed' : 'denied');
export const [excludedListReads, setExcludedListReads] = createSignal(0);
const pendingPrivacyRead = Promise.withResolvers<void>();
export const finishPrivacyRead = () => pendingPrivacyRead.resolve();
let privacyReads = 0;
export const mailboxId = '00000000-0000-4000-8000-000000000045';
const [state, setState] = createSignal<EmailPrivacy>({
  enabled: params.has('contributing'),
  mailboxEmail: params.has('disconnected') ? null : 'member@example.com',
  mailboxLinkId: params.has('disconnected') ? null : mailboxId,
  teamDomains: params.has('mailbox-guard')
    ? ['example.com']
    : ['team.example.com'],
  personalDomains: params.has('mailbox-guard')
    ? ['gmail.com']
    : ['personal.example.com'],
  teamDomainWarnings: params.has('mailbox-guard')
    ? { 'example.com': 'company' }
    : {},
  personalDomainWarnings: params.has('mailbox-guard')
    ? { 'gmail.com': 'personal_provider' }
    : {},
  canRemoveTeamDomains: params.has('admin'),
});
export const [lastChange, setLastChange] = createSignal('');
export const [statusUnavailable, setStatusUnavailable] = createSignal(
  params.has('status-unavailable')
);
function apply(change: EmailPrivacyChange): EmailPrivacy {
  setLastChange(JSON.stringify(change));
  if (change.action === 'set_consent') {
    setState((s) => ({ ...s, enabled: change.enabled }));
  } else if (change.action === 'set_thread_exclusion') {
    setThreads((threads) =>
      change.excluded
        ? [
            ...threads,
            {
              threadId: change.thread_id,
              linkId: mailboxId,
              subject: 'Private conversation',
            },
          ]
        : threads.filter((thread) => thread.threadId !== change.thread_id)
    );
  } else {
    const key = change.scope === 'team' ? 'teamDomains' : 'personalDomains';
    setState((s) => ({
      ...s,
      [key]:
        change.action === 'add_domain'
          ? [...s[key], change.domain]
          : s[key].filter((domain) => domain !== change.domain),
    }));
  }
  return state();
}
const [threads, setThreads] = createSignal([
  {
    threadId: '00000000-0000-4000-8000-000000000046',
    linkId: mailboxId,
    subject: 'Private conversation',
  },
  ...(params.has('paged')
    ? [
        {
          threadId: '00000000-0000-4000-8000-000000000047',
          linkId: mailboxId,
          subject: 'Another private conversation',
        },
      ]
    : []),
]);
export const useCrmContext = () => ({
  canAccess: crmAccess,
  accessState: () => (crmAccess() ? 'allowed' : 'denied'),
  retryAccess: async () => {},
  EmailThreadMention,
  createEmailPrivacy: () =>
    createEmailPrivacySource(
      {
        client: useQueryClient(),
        privacy: crmEmailPrivacyClient,
        feedback: toast,
      },
      () => '00000000-0000-4000-8000-000000000048',
      useUserId()
    ),
  createEmailPolicy: () =>
    createEmailPolicySource(
      { client: useQueryClient(), policy: policyClient, feedback: toast },
      () => '00000000-0000-4000-8000-000000000048',
      useUserId()
    ),
  createNavigation: useSplitLayout,
});

export const useCurrentTeamQuery = () => ({
  isSuccess: true,
  data: params.has('no-team')
    ? undefined
    : { team: { id: '00000000-0000-4000-8000-000000000048' } },
});
export const useIsTeamAdmin = () => () => params.has('admin');
export const useUserId = () => () => 'member@example.com';
export const useEmail = () => () => 'member@example.com';
export const useAuthor = () => () => 'Example Member';
export const useLicenseStatus = () => () => undefined;
export const useIsAuthenticated = () => () => true;
export const usePosthog = () => ({
  instance: { capture() {} },
  featureFlags: () => [],
  flagsLoaded: () => true,
  flagsUnreachable: () => false,
});
export const [lastToast, setLastToast] = createSignal('');
export const toast = { success: setLastToast, failure: setLastToast };
export const useFeatureFlag = (flag: { key: string }) => () => ({
  enabled:
    (flag.key === 'enable-crm-thread-exclusions' && !params.has('flag-off')) ||
    (flag.key === 'enable-crm-selective-email-contribution' &&
      params.has('selective-settings') &&
      !params.has('policy-gate-off')),
  loading:
    flag.key === 'enable-crm-selective-email-contribution' &&
    params.has('policy-flag-pending'),
});
function response() {
  const value = state();
  return {
    enabled: value.enabled,
    mailbox_email: value.mailboxEmail,
    mailbox_link_id: value.mailboxLinkId,
    team_domains: value.teamDomains,
    personal_domains: value.personalDomains,
    team_domain_warnings: value.teamDomainWarnings ?? {},
    personal_domain_warnings: value.personalDomainWarnings ?? {},
    can_remove_team_domains: value.canRemoveTeamDomains,
  };
}
export const crmEmailPrivacyClient = {
  getConsent: async () => {
    const { enabled, mailbox_email, mailbox_link_id } = response();
    return params.has('failed')
      ? err([{ code: 'NETWORK_ERROR' as const, message: 'Unavailable' }])
      : ok({ enabled, mailbox_email, mailbox_link_id });
  },
  get: async () => {
    privacyReads += 1;
    if (params.has('privacy-pending')) await pendingPrivacyRead.promise;
    return params.has('failed') ||
      (params.has('privacy-retry') && privacyReads === 1) ||
      (params.has('privacy-refresh-failed') && privacyReads > 1)
      ? err([{ code: 'NETWORK_ERROR' as const, message: 'Unavailable' }])
      : ok(response());
  },
  excludedThreads: async (
    after?: string,
    _signal?: AbortSignal,
    threadId?: string
  ) => {
    if (!threadId) setExcludedListReads((count) => count + 1);
    if (threadId && statusUnavailable())
      return err([{ code: 'NETWORK_ERROR' as const, message: 'Unavailable' }]);
    const matching = threads()
      .filter((thread) =>
        threadId
          ? thread.threadId === threadId
          : !after || thread.threadId > after
      )
      .toSorted((a, b) => a.threadId.localeCompare(b.threadId));
    const page =
      !threadId && params.has('paged') ? matching.slice(0, 1) : matching;
    return ok({
      threads: page.map((thread) => ({
        thread_id: thread.threadId,
        link_id: thread.linkId,
        subject: thread.subject,
      })),
      next_cursor:
        matching.length > page.length ? (page.at(-1)?.threadId ?? null) : null,
    });
  },
  update: async (change: EmailPrivacyChange) => {
    if (params.has('mailbox-guard') && change.action === 'add_domain') {
      const domain = change.domain.toLowerCase();
      if (domain === 'example.com' || domain === 'gmail.com') {
        return err([
          {
            code: 'HTTP_ERROR' as const,
            message:
              domain === 'example.com'
                ? t('crm.privacyCompanyMailboxDomain')
                : t('crm.privacyPersonalMailboxDomain'),
          },
        ]);
      }
    }
    apply(change);
    return ok(response());
  },
};
