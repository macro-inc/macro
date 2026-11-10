/* Fails Sign in with Microsoft closed unless Microsoft vouches for the email.

   The `microsoft` IdP admits accounts from any Entra tenant (`common`) and
   links by email, so it may create or link a user only on an address whose
   domain Microsoft has verified for the account. Microsoft says so with the
   optional `xms_edov` ID-token claim (email domain owner verified); it never
   sends `email_verified`. The IdP's `emailVerifiedClaim` is `xms_edov`, which
   makes FusionAuth refuse a false value, but FusionAuth links when the claim
   is missing, so this lambda refuses that case too.

   `id_token` is null unless FusionAuth verified its signature, which needs the
   IdP's issuer (discovery and JWKS), not hand-set endpoints. Throwing fails the
   login and FusionAuth creates and links nothing.

   Also maps the profile claims onto the user: assigning a reconcile lambda
   replaces FusionAuth's default one, so without this the user is created with
   no name and the user.create webhook has nothing to seed the Macro profile
   with.

   BLOCK comments only in this file, as in reconcile_secondary_idp_link.js:
   FusionAuth's KickstartRunner flattens a lambda body to a single line, so a
   `//` comment would swallow all the code after it. */
/* biome-ignore lint/correctness/noUnusedVariables: FusionAuth invokes this by name. */
function reconcile(user, registration, jwt, id_token, tokens) {
  function email(value) {
    return typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase()
      : null;
  }

  /* FusionAuth resolves the email from userinfo first, then the id_token. */
  var tokenEmail = email(id_token && id_token.email);
  var linkedEmail = email(jwt && jwt.email) || tokenEmail;
  var verified = id_token ? id_token.xms_edov : undefined;
  var domainVerified =
    verified === true || verified === 1 || verified === 'true' || verified === '1';

  if (!id_token || !tokenEmail || tokenEmail !== linkedEmail || !domainVerified) {
    throw new Error(
      'Microsoft did not verify that this account owns its email address. Sign in with your email instead.'
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
