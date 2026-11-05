/** Account manager requests in DMs, the token page, and the settings tab. */
export default {
  requestAction: 'Account manager',
  requestDialogTitle: 'Account manager',
  askToBeManaged: 'Ask {{name}} to manage my account',
  askToBeManagedWarning:
    '{{name}} will get full access to your account until you revoke it in Settings → Account Managers.',
  askToManage: 'Ask to manage {{name}}’s account',
  askToManageWarning:
    'If {{name}} approves, this account gets a token with full access to theirs.',
  requestSent: 'Request sent',
  requestFailed: 'Couldn’t send the request',
  cancel: 'Cancel',

  cardTitleManaged: '{{name}} wants to manage your account',
  cardTitleManager: '{{name}} wants you to manage their account',
  cardOwnRequestManaged: 'You asked {{name}} to manage your account',
  cardOwnRequestManager: 'You asked to manage {{name}}’s account',
  cardApprovedManaged: '{{name}} can now reveal a token for your account',
  cardApprovedManager: 'You can reveal your token for {{name}}’s account',
  cardActiveManaged: '{{name}} manages your account',
  cardActiveManager: 'You manage {{name}}’s account',
  cardDeclined: 'This request was declined',
  cardRevoked: 'This access has ended',
  cardExpired: 'This request expired',
  cardUnavailable: 'This request isn’t available',
  cardWaiting: 'Waiting for a response',
  cardFullAccess: 'Full access until revoked',
  cardExpires: 'Expires {{date}} unless the token is revealed',

  approve: 'Approve',
  decline: 'Decline',
  withdraw: 'Withdraw',
  revealToken: 'Reveal token',
  actionFailed: 'Something went wrong. Try again.',

  confirmTitle: 'Approve account manager',
  confirmManaged:
    '{{name}} will get a token with full access to your account: your documents, messages, and everything else except its managers, API keys, sign-in, and deleting the account. It lasts until you revoke it in Settings → Account Managers.',
  confirmManager: 'You’ll get a token with full access to {{name}}’s account.',

  tokenTitle: 'Your token',
  tokenLabel: 'SDK token',
  tokenHelp: 'Shown only once',
  tokenWarning:
    'Save this token now. It can’t be shown again; if you lose it, request access again.',
  done: 'Done',

  pageTitle: 'Account manager access',
  settingsTitle: 'Account Managers',
  settingsDescription:
    'Agent accounts with full access to your account. Revoking stops their token immediately; anything they already created stays.',
  settingsEmpty: 'No one manages your account.',
  settingsLoadFailed: 'Couldn’t load account managers.',
  settingsGranted: 'Token revealed {{time}}',
  settingsLastUsed: 'Last used {{time}}',
  settingsNeverUsed: 'Not used yet',
  settingsAwaitingClaim: 'Approved. Token not revealed yet.',
  revoke: 'Revoke',
  revokeTitle: 'Revoke account manager',
  revokeConfirm:
    '{{name}} will lose access to your account immediately. Anything it already created stays.',
  revoked: 'Access revoked',
  revokeFailed: 'Couldn’t revoke access',
};
