// Aborts an OpenIDConnect login whose id_token email doesn't match the FA user's
// email. Triggers on FA links created via /link/gmail — those links bind a Google
// account to a primary macro user as a secondary inbox; signing in with that
// Google account must not yield a session for the primary user.
function reconcile(user, registration, jwt, id_token, tokens) {
  if (
    jwt &&
    jwt.email &&
    user &&
    user.email &&
    jwt.email.toLowerCase() !== user.email.toLowerCase()
  ) {
    throw new Error(
      'This Google account is linked as a secondary inbox to another Macro account. Sign in with your primary email or contact support.'
    );
  }
}
