import { useSplitLayout } from '@components/app/split-layout/layout';
import { useQueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  EmailPrivacy,
  EmailPrivacyChange,
} from '../../core/email-privacy';
import { createEmailPrivacySource } from '../../queries/email-privacy';

const params = new URLSearchParams(location.search);
export const mailboxId = '00000000-0000-4000-8000-000000000045';
const [state, setState] = createSignal<EmailPrivacy>({
  enabled: params.has('contributing'),
  mailboxEmail: params.has('disconnected') ? null : 'member@example.com',
  mailboxLinkId: params.has('disconnected') ? null : mailboxId,
  teamDomains: ['team.example.com'],
  personalDomains: ['personal.example.com'],
  canRemoveTeamDomains: params.has('admin'),
});
export const [lastChange, setLastChange] = createSignal('');
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
  createNavigation: useSplitLayout,
});

export const useCurrentTeamQuery = () => ({
  isSuccess: true,
  data: params.has('no-team')
    ? undefined
    : { team: { id: '00000000-0000-4000-8000-000000000048' } },
});
export const useUserId = () => () => 'member@example.com';
export const useIsAuthenticated = () => () => true;
export const [lastToast, setLastToast] = createSignal('');
export const toast = { success: setLastToast, failure: setLastToast };
export const useFeatureFlag = () => () => ({
  enabled: !params.has('flag-off'),
  loading: false,
});
function response() {
  const value = state();
  return {
    enabled: value.enabled,
    mailbox_email: value.mailboxEmail,
    mailbox_link_id: value.mailboxLinkId,
    team_domains: value.teamDomains,
    personal_domains: value.personalDomains,
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
  get: async () =>
    params.has('failed')
      ? err([{ code: 'NETWORK_ERROR' as const, message: 'Unavailable' }])
      : ok(response()),
  excludedThreads: async (
    after?: string,
    _signal?: AbortSignal,
    threadId?: string
  ) => {
    const matching = threadId
      ? threads().filter((thread) => thread.threadId === threadId)
      : threads();
    const page =
      !threadId && params.has('paged')
        ? after
          ? matching.slice(1)
          : matching.slice(0, 1)
        : matching;
    return ok({
      threads: page.map((thread) => ({
        thread_id: thread.threadId,
        link_id: thread.linkId,
        subject: thread.subject,
      })),
      next_cursor:
        !threadId && params.has('paged') && !after
          ? matching[0]?.threadId
          : null,
    });
  },
  update: async (change: EmailPrivacyChange) => {
    apply(change);
    return ok(response());
  },
};
