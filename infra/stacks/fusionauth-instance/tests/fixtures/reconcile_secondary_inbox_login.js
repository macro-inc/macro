/* Experimental only: never deploy this handoff. Concurrent logins in 1.69.4
   can validate another attempt's stored decision. The hosted-login reproducer
   demonstrates why the deployed reconciliation rejection must stay in place. */
/* biome-ignore lint/correctness/noUnusedVariables: FusionAuth invokes this by name. */
function reconcile(user, registration, jwt) {
  var jwtEmail =
    jwt && typeof jwt.email === 'string' ? jwt.email.toLowerCase() : null;
  var userEmail =
    user && typeof user.email === 'string' ? user.email.toLowerCase() : null;
  if (!jwtEmail || !userEmail) {
    throw new Error('Unable to verify the sign-in email.');
  }
  user.data = user.data || {};
  user.data.macroPrimaryEmailLogin = jwtEmail === userEmail;
}
