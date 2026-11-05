import { ThrownResultError } from '@core/util/result';
import '@fontsource-variable/inter';
import '../../../../index.css';
import type {
  ComputerSize,
  TeamAgent,
  TeamAgentQuote,
} from '@service-auth/generated/schemas';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { InviteAgentForm } from '../../components/invite-agent-form';
import {
  AgentStatusPill,
  TeamAgentMenu,
} from '../../components/team-agent-row';
import { BillingFixture } from './billing-fixture';
import { MembersFixture } from './members-fixture';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';
const [open, setOpen] = createSignal(false);
const [size, setSize] = createSignal<ComputerSize>('standard');
const [requests, setRequests] = createSignal(0);
const [failed, setFailed] = createSignal(
  new URLSearchParams(location.search).has('quote-error')
);
const [included, setIncluded] = createSignal(
  new URLSearchParams(location.search).has('included')
);
let changeEligibility = new URLSearchParams(location.search).has(
  'quote-changed'
);
const repositoryFailure = new URLSearchParams(location.search).has(
  'repository-failure'
);
const quote = (value: ComputerSize = size()): TeamAgentQuote => ({
  included: included(),
  seat: included() ? 0 : 2000,
  computer: included() ? 0 : value === 'standard' ? 3000 : 6000,
  total: included() ? 0 : value === 'standard' ? 5000 : 8000,
  currency: 'usd',
  vcpus: value === 'standard' ? 2 : 4,
  memoryGb: value === 'standard' ? 8 : 16,
  diskGb: 100,
  interval: 'month',
});
const noSubscription = new URLSearchParams(location.search).has(
  'no-subscription'
);
const showPayments = new URLSearchParams(location.search).has('payments');
const initialAgent: TeamAgent = {
  userId: 'agent-1',
  teamId: 'team-1',
  name: 'Assistant',
  email: 'agent@example.com',
  createdAt: '2026-01-01',
  status: 'provisioning',
  payment: 'pending',
  retryable: false,
  setup: { step: 'paying', position: 1, total: 5 },
};
const [agent, setAgent] = createSignal(initialAgent);
const [retryRequests, setRetryRequests] = createSignal(0);
const [removals, setRemovals] = createSignal(0);
render(
  () => (
    <Show
      when={!new URLSearchParams(location.search).has('billing')}
      fallback={<BillingFixture />}
    >
      <Show
        when={!new URLSearchParams(location.search).has('members')}
        fallback={<MembersFixture />}
      >
        <div class="p-6 bg-panel min-h-screen text-ink">
          <Button onClick={() => setOpen(true)}>Invite agent</Button>
          <p>Purchases: {requests()}</p>
          <Show when={showPayments}>
            <div class="space-y-4 py-5">
              <Button
                onClick={() =>
                  setAgent({
                    ...initialAgent,
                    status: 'failed',
                    payment: 'unbilled',
                    statusReason: 'payment failed',
                  })
                }
              >
                Set payment failure
              </Button>
              <Button
                onClick={() =>
                  setAgent({
                    ...initialAgent,
                    status: 'failed',
                    payment: 'paid',
                    retryable: true,
                    statusReason: 'Brain unavailable',
                  })
                }
              >
                Set paid failure
              </Button>
              <AgentStatusPill
                agent={agent()}
                onRetry={() => {
                  setRetryRequests((count) => count + 1);
                  setAgent({
                    ...agent(),
                    status: 'provisioning',
                    retryable: false,
                    setup: { step: 'booting', position: 3, total: 5 },
                  });
                }}
              />
              <TeamAgentMenu
                agent={agent()}
                onRemove={() => setRemovals((count) => count + 1)}
              />
              <p>Retry requests: {retryRequests()}</p>
              <p>Removals: {removals()}</p>
            </div>
          </Show>
          <Show when={open()}>
            <InviteAgentForm
              teamId="team-1"
              open
              onClose={() => setOpen(false)}
              size={size()}
              setSize={setSize}
              source={{
                specsForSize: (value) => ({ ...quote(value), size: value }),
                needsSubscription: () => noSubscription && !included(),
                quote: () =>
                  failed() || (noSubscription && !included())
                    ? undefined
                    : quote(),
                quoteLoading: () => false,
                quoteError: () => failed() || (noSubscription && !included()),
                reloadQuote: () => setFailed(false),
                pending: () => false,
                create: async (request) => {
                  if (changeEligibility) {
                    changeEligibility = false;
                    setIncluded(!included());
                  }
                  if (request.expectedIncluded !== included()) {
                    throw new ThrownResultError([
                      {
                        code: 'quote_changed',
                        message:
                          'The quote changed. Review the price again. Nothing was charged.',
                      },
                    ]);
                  }
                  if (repositoryFailure) {
                    throw new ThrownResultError([
                      {
                        code: 'repository_creation_failed',
                        message:
                          'The workspace repository could not be created. Nothing was charged.',
                      },
                    ]);
                  }
                  setRequests((count) => count + 1);
                },
              }}
            />
          </Show>
        </div>
      </Show>
    </Show>
  ),
  document.getElementById('root')!
);
