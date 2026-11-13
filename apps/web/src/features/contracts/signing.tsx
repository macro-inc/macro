import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableContracts } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { createBrowserContracts } from './browser-contracts';
import { SigningProvider } from './context/contracts-context';
import { SignerPortal } from './views/signer-portal';

function Signing(props: { token: string }) {
  const signing = createBrowserContracts().signing(() => props.token);
  return (
    <SigningProvider value={signing}>
      <SignerPortal />
    </SigningProvider>
  );
}

/** The public signing page for one recipient's link. No account is needed. */
export function SigningPage(props: { token: string }) {
  const flag = useFeatureFlag(enableContracts, {
    enabledWhenUnreachable: true,
  });
  return (
    <Show
      when={flag().enabled}
      fallback={
        <p class="p-12 text-center text-sm text-ink-muted">
          {flag().loading
            ? t('contracts.loadingDocument')
            : t('contracts.signingUnavailable')}
        </p>
      }
    >
      <Signing token={props.token} />
    </Show>
  );
}
