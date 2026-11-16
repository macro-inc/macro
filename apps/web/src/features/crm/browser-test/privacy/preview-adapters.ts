import { ok } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import type {
  EmailPrivacy,
  EmailPrivacyChange,
} from '../../core/email-privacy';

const params = new URLSearchParams(location.search);
export const mailboxId = '00000000-0000-4000-8000-000000000045';
const [state, setState] = createSignal<EmailPrivacy>({
  enabled: false,
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
const source = {
  createExcludedThreads: (after: Accessor<string | undefined>) => ({
    isSuccess: true,
    isError: false,
    isPending: false,
    isLoading: false,
    get data() {
      if (!params.has('paged')) return { threads: threads(), nextCursor: null };
      return {
        threads: after() ? threads().slice(1) : threads().slice(0, 1),
        nextCursor: after() ? null : threads()[0]?.threadId,
      };
    },
    refetch: () => Promise.resolve(),
  }),
  query: {
    isSuccess: true,
    isError: false,
    get data() {
      return state();
    },
    refetch: () => Promise.resolve(),
  },
  update: {
    isPending: false,
    mutate(
      change: EmailPrivacyChange,
      options?: { onSuccess?: (data: EmailPrivacy) => void }
    ) {
      const data = apply(change);
      options?.onSuccess?.(data);
    },
    mutateAsync: (change: EmailPrivacyChange) => Promise.resolve(apply(change)),
  },
};
export const useCrmContext = () => ({ createEmailPrivacy: () => source });

export const useCurrentTeamQuery = () => ({
  isSuccess: true,
  data: { team: { id: '00000000-0000-4000-8000-000000000048' } },
});
export const useUserId = () => () => 'member@example.com';
export const toast = { success: () => {}, failure: () => {} };
export const useFeatureFlag = () => () => ({
  enabled: !params.has('flag-off'),
  loading: false,
});
export const crmEmailPrivacyClient = {
  update: async (change: EmailPrivacyChange) => {
    const value = apply(change);
    return ok({
      enabled: value.enabled,
      mailbox_email: value.mailboxEmail,
      mailbox_link_id: value.mailboxLinkId,
      team_domains: value.teamDomains,
      personal_domains: value.personalDomains,
      can_remove_team_domains: value.canRemoveTeamDomains,
    });
  },
};
