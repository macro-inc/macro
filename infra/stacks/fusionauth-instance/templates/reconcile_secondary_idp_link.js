/* Aborts an OpenIDConnect login whose id_token email doesn't match the FA
   user's email. Triggers on FA links created via /link/gmail: those links bind
   a Google account to a primary macro user as a secondary inbox; signing in
   with that Google account must not yield a session for the primary user.

   Fails closed: missing jwt.email or user.email is treated the same as a
   mismatch. Google always returns email when the openid+email scopes are
   granted, so legitimate primary sign-ins always satisfy the check.

   Also maps Google's profile claims onto the user. Assigning a reconcile
   lambda replaces FusionAuth's default one, so without this the user is
   created with no name and the user.create webhook has nothing to seed the
   macro profile with.

   BLOCK comments only in this file: it is deployed both via Pulumi (dev/prod)
   and via the local kickstart, and FusionAuth's KickstartRunner flattens the
   lambda body to a single line, so a `//` comment swallows all the code after
   it. */
/* biome-ignore lint/correctness/noUnusedVariables: FusionAuth invokes this by name. */
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

  /* Claims live on the userinfo response; fall back to the id_token. */
  function claim(name) {
    var value = jwt && jwt[name];
    if (typeof value !== 'string' || !value.trim()) {
      value = id_token && id_token[name];
    }
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  /* Only fill what's missing: this runs on every login, and the user may have
     since changed their name in Macro. */
  if (!user.firstName) {
    user.firstName = claim('given_name');
  }
  if (!user.lastName) {
    user.lastName = claim('family_name');
  }
  if (!user.fullName) {
    user.fullName = claim('name');
  }
}
