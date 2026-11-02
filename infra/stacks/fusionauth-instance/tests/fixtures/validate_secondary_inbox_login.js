/* Experimental only: never deploy. user.data is not an attempt-scoped handoff
   in FusionAuth 1.69.4, even when validation does not fetch the user itself. */
/* biome-ignore lint/correctness/noUnusedVariables: FusionAuth invokes this by name. */
function validate(result, user, registration, context) {
  if (
    context.authenticationType !== 'OPENID_CONNECT' ||
    !context.identityProvider ||
    context.identityProvider.name !== 'google_gmail'
  ) {
    return;
  }

  var decision = user.data && user.data.macroPrimaryEmailLogin;
  if (decision === true) {
    return;
  }

  if (decision === false) {
    result.errors.generalErrors.push({
      code: '[SecondaryInboxLogin]',
      message:
        'This Google account is connected as an additional inbox. Sign in with the email you originally used to create your Macro account. Return to Macro and choose Continue with email, or contact support.',
    });
  } else {
    result.errors.generalErrors.push({
      code: '[PrimaryEmailLoginUnverified]',
      message:
        "We couldn't verify this sign-in. Return to Macro and choose Continue with email, or contact support.",
    });
  }
}
