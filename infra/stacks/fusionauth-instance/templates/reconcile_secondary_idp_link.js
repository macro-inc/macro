// Aborts an OpenIDConnect login whose id_token email doesn't match the FA user's
// email. Triggers on FA links created via /link/gmail — those links bind a Google
// account to a primary macro user as a secondary inbox; signing in with that
// Google account must not yield a session for the primary user.
//
// Fails closed: missing jwt.email or user.email is treated the same as a
// mismatch. Google always returns email when the openid+email scopes are
// granted, so legitimate primary sign-ins always satisfy the check.
function reconcile(user, registration, jwt, id_token, tokens) {
  var jwtEmail =
    jwt && typeof jwt.email === 'string' ? jwt.email.toLowerCase() : null;
  var userEmail =
    user && typeof user.email === 'string' ? user.email.toLowerCase() : null;

  if (!jwtEmail || !userEmail || jwtEmail !== userEmail) {
    throw new Error(
      'This Google account is linked as a secondary inbox to another Macro account. Sign in with your primary email or contact support.'
    );
  }
}
