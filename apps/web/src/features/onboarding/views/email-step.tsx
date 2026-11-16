import { fireAndForget } from '@core/util/fireAndForget';
import { createEffect, on } from 'solid-js';
import { GoogleAccountsStep } from '../components/google-accounts-step';
import { useOnboardingContext } from '../context/onboarding-context';
import type { SignupProvider } from '../core/signup-draft';
import { createEmailAccounts } from '../primitives/email-accounts';

/** Connect Google or Outlook accounts. On web the add-inbox flow is a
 * full-page OAuth redirect; the flow's persisted step brings the user back here. */
export function EmailStep(props: {
  mode: 'work' | 'personal';
  /** The provider that just created the account, read once after sign-up. */
  signupProvider?: SignupProvider;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const context = useOnboardingContext();
  const inboxes = createEmailAccounts(context, context.createEmailAccounts());
  const outlookAvailable = context.createOutlookAvailability();
  const offerOutlook = () => props.mode === 'work' && outlookAvailable();

  // A Microsoft sign-up continues straight into Outlook consent, as Google
  // sign-up already connects Gmail. Declining or a blocked tenant lands back
  // here, where the account stays usable and Skip still works.
  let chained = false;
  createEffect(
    on(
      () =>
        props.signupProvider === 'microsoft' &&
        offerOutlook() &&
        inboxes.accounts().t === 'ready' &&
        inboxes.primary() === undefined,
      (ready) => {
        if (!ready || chained) return;
        chained = true;
        fireAndForget(inboxes.connect('work', 'microsoft'), 'onboarding');
      }
    )
  );

  return (
    <GoogleAccountsStep
      mode={props.mode}
      accountEmail={inboxes.primary()?.address}
      workConnected={inboxes.primary() !== undefined}
      personalEmail={inboxes.secondary()?.address}
      connecting={inboxes.connecting()}
      microsoftConnecting={inboxes.connectingProvider() === 'microsoft'}
      loading={inboxes.accounts().t === 'loading'}
      error={
        inboxes.accounts().t === 'error'
          ? "Couldn't load your connected accounts."
          : undefined
      }
      onRetry={inboxes.retry}
      onConnectWork={() =>
        fireAndForget(
          inboxes.connect('work', offerOutlook() ? 'google' : undefined),
          'onboarding'
        )
      }
      onConnectMicrosoft={
        offerOutlook()
          ? () =>
              fireAndForget(inboxes.connect('work', 'microsoft'), 'onboarding')
          : undefined
      }
      onConnectPersonal={() =>
        fireAndForget(inboxes.connect('personal'), 'onboarding')
      }
      onContinue={props.onContinue}
      onSkip={props.onSkip}
    />
  );
}
