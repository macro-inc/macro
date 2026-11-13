import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableContracts } from '@core/constant/featureFlags';
import { errAsync } from 'neverthrow';
import { Show } from 'solid-js';
import { createBrowserContractsForToken } from './browser-contracts';
import {
  type ContractsError,
  type SigningContext,
  SigningProvider,
} from './context/contracts-context';
import { SignerPortal } from './views/signer-portal';

const NO_ACTION = () => errAsync<never, ContractsError>({ kind: 'not_found' });

/** A link no account in this browser issued: it opens nothing. */
const UNKNOWN_LINK: SigningContext = {
  session: () => ({ t: 'unavailable' }),
  openDocument: () => errAsync({ kind: 'missing' }),
  recordView: NO_ACTION,
  acceptDisclosure: NO_ACTION,
  sign: NO_ACTION,
  decline: NO_ACTION,
};

function Signing(props: { token: string }) {
  const signing =
    createBrowserContractsForToken(props.token)?.signing(() => props.token) ??
    UNKNOWN_LINK;
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
      {/* Keyed: another link opens its own sender's store. */}
      <Show when={props.token} keyed>
        {(token) => <Signing token={token} />}
      </Show>
    </Show>
  );
}
