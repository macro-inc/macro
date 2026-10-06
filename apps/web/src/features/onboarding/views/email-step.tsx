import { GoogleAccountsStep } from '../components/google-accounts-step';
import { useOnboardingContext } from '../context/onboarding-context';
import { createEmailAccounts } from '../primitives/email-accounts';

/** Connect Google accounts. On web the add-inbox flow is a full-page OAuth
 * redirect; the flow's persisted step brings the user back here. */
export function EmailStep(props: {
  mode: 'work' | 'personal';
  onContinue: () => void;
  onSkip: () => void;
}) {
  const context = useOnboardingContext();
  const inboxes = createEmailAccounts(context, context.createEmailAccounts());
  return (
    <GoogleAccountsStep
      mode={props.mode}
      accountEmail={inboxes.primary()?.address}
      workConnected={inboxes.primary() !== undefined}
      personalEmail={inboxes.secondary()?.address}
      connecting={inboxes.connecting()}
      loading={inboxes.accounts().t === 'loading'}
      error={
        inboxes.accounts().t === 'error'
          ? "Couldn't load your connected accounts."
          : undefined
      }
      onRetry={inboxes.retry}
      onConnectWork={() => void inboxes.connect('work')}
      onConnectPersonal={() => void inboxes.connect('personal')}
      onContinue={props.onContinue}
      onSkip={props.onSkip}
    />
  );
}
