# FusionAuth Instance Stack

This pulumi stack contains everything you need to be able to setup a "macro compliant" fusionauth instance.

Supports easy setup for local development.

# Prerequisites

The following are required tools you need to have setup ahead of time:

`docker` and `docker-compose`
`pulumi`
`aws-cli`
`just`

# Usage
**Important** do not use `macro-inc/` prefix when you make your fusionauth-instance local stack. This is meant to be stored on __your__ pulumi account only (local to you) not on the organization.

## Deploy Local Fusionauth Instance

Make sure you've already created your main **.env** file in the root of the repo via `just get_environment`.

Run `just setup` to setup the local fusionauth instance and get everything ready to be run.

Important Keys:

```
username: admin@macro.com
password: macroIsGreat!
api-key: bf69486b-4733-4954-a44e-2e1b5f2c8a91
```

# Post-deploy manual steps

Some FA configuration isn't yet declared in Pulumi and must be applied through the FA admin UI per environment after a deploy.

## Wire `reconcile_secondary_idp_link` to the `google_gmail` IdP

Background: `/link/gmail` creates a FA IdP link binding a Google account to the calling macro user. Because FA enforces global uniqueness on `(identity_provider_id, identity_provider_user_id)` and uses the same pair for login routing, that link silently doubles as "anyone signing in with this Google account lands as the linking user." The reconcile lambda blocks the login by comparing the id_token's email against the FA user's email — they match for primary links (signup) and differ for secondary links (added via `/link/gmail`).

After the Pulumi stack deploys, in the FA admin UI of the target tenant:

1. Identity Providers → `google_gmail` → Edit.
2. Lambda settings → Reconcile → select `reconcile_secondary_idp_link` (lambda id `b8c1f6d3-5e2a-4d8b-9f7e-2c3d4e5f6a7b`).
3. Save.

Test by attempting "Sign in with Google" using a Google account that was previously added as a secondary inbox — login should fail with the reconcile lambda's error message.

# TODO
- [ ] configure idps in Pulumi (would let the lambda wiring above become declarative)
- [ ] sync prod with pulumi stack
