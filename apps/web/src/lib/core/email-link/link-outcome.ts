import { toast } from '@core/component/Toast/Toast';

/**
 * Where a plain add started: its provider and the inboxes already connected.
 * The provider's account chooser can hand back one of those accounts (for
 * example a Google Workspace user signed in under a secondary domain); init
 * then succeeds with the existing inbox and adds nothing, so only this
 * snapshot tells that apart from a new connection.
 */
export type InboxAddition = {
  provider: 'GMAIL' | 'OUTLOOK';
  connectedInboxes: { id: string; emailAddress: string }[];
};

function chooseAnotherAccountHint(provider?: InboxAddition['provider']) {
  if (provider === 'GMAIL')
    return 'To add another inbox, choose a different account in Google’s account chooser.';
  if (provider === 'OUTLOOK')
    return 'To add another inbox, sign in with a different Microsoft account.';
  return 'To add another inbox, choose a different account when you sign in.';
}

export function announceAlreadyConnected(
  provider?: InboxAddition['provider'],
  emailAddress?: string
) {
  toast.alert(
    emailAddress
      ? `${emailAddress} is already connected`
      : 'This account is already connected',
    { subtext: chooseAnotherAccountHint(provider) }
  );
}

/** Announces a successful init and returns its analytics outcome. */
export function announceLinkedInbox(
  linkId: string,
  addition: InboxAddition | undefined
): 'connected' | 'already_connected' {
  const existing = addition?.connectedInboxes.find(
    (inbox) => inbox.id === linkId
  );
  if (addition && existing) {
    announceAlreadyConnected(addition.provider, existing.emailAddress);
    return 'already_connected';
  }
  toast.success('Account connected');
  return 'connected';
}

export function announceConsentCancelled() {
  toast.alert('Account not connected', {
    subtext: 'Sign-in was cancelled before access was granted.',
  });
}
