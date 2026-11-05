import '@fontsource-variable/inter';
import '../../../../index.css';
import type {
  ComputerSize,
  TeamAgentQuote,
} from '@service-auth/generated/schemas';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { InviteAgentForm } from '../../components/invite-agent-form';

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
const quote = (value: ComputerSize = size()): TeamAgentQuote => ({
  seat: 2000,
  computer: value === 'standard' ? 3000 : 6000,
  total: value === 'standard' ? 5000 : 8000,
  currency: 'usd',
  vcpus: value === 'standard' ? 2 : 4,
  memoryGb: value === 'standard' ? 8 : 16,
  diskGb: 100,
  interval: 'month',
});
render(
  () => (
    <div class="p-6 bg-panel min-h-screen text-ink">
      <Button onClick={() => setOpen(true)}>Invite agent</Button>
      <p>Purchases: {requests()}</p>
      <Show when={open()}>
        <InviteAgentForm
          open
          onClose={() => setOpen(false)}
          size={size()}
          setSize={setSize}
          source={{
            quoteForSize: (value) => (failed() ? undefined : quote(value)),
            quote: () => (failed() ? undefined : quote()),
            quoteLoading: () => false,
            quoteError: failed,
            reloadQuote: () => setFailed(false),
            pending: () => false,
            error: () => false,
            create: async () => {
              setRequests((count) => count + 1);
            },
          }}
        />
      </Show>
    </div>
  ),
  document.getElementById('root')!
);
