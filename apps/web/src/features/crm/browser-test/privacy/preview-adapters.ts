import { createSignal } from 'solid-js';
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
const source = {
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
