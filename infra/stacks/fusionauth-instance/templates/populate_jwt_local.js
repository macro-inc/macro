/* LOCAL-ONLY variant of populate_jwt.js, used by the run_local kickstart
   (tooling/xtask/crates/xtask_local). Production enriches the JWT by calling
   authentication-service over HTTP, but Lambda HTTP Connect is a licensed
   FusionAuth feature that silently fails without a Reactor license. Local runs
   unlicensed, so derive the claims instead: every user gets `macro|<email>`
   regardless of signup method (production's webhook path lands on the same
   convention, MacroUserIdStr::try_from_email). root_macro_id and
   macro_organization_id are never populated: org-scoped JWT flows need the
   licensed lambda.

   BLOCK comments only in this file: FusionAuth's KickstartRunner flattens the
   lambda body to a single line, so a `//` comment swallows all the code after
   it. The Pulumi/API deploy path preserves newlines; kickstart does not. */
/* biome-ignore lint/correctness/noUnusedVariables: FusionAuth invokes this by name. */
function populate(jwt, user, _registration) {
  jwt.fusion_user_id = user.id;
  jwt.email = user.email;
  jwt.macro_user_id = 'macro|' + user.email;
}
