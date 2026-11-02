# FusionAuth Instance Stack

This pulumi stack contains everything you need to be able to setup a "macro compliant" fusionauth instance.

Supports easy setup for local development.

The local FusionAuth container runs with `init: true` to reap orphaned health-check
processes. Recreate existing FusionAuth containers to apply this setting; restarting
them does not update their configuration. Keep their database and config volumes.

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

## Sign-in validation error message

`update-theme-message.ts` sets `[IdentityProviderValidationException]` to
conditional sign-in recovery guidance. It replaces or adds this one single-line
entry, preserving the rest of `defaultMessages`. The PATCH sends no templates
or other theme settings. Authentication and reconciliation are unchanged.
The updater and Pulumi configuration share the theme IDs in `theme-ids.ts`.
Before applying, save any existing value of this entry for rollback.

```sh
# From this directory; uses the stack's existing Pulumi host and API key.
bun update-theme-message.ts dev          # read-only preview (or use prod)
bun update-theme-message.ts dev --apply  # only after authorization
```

Merging or deploying this stack does **not** apply the copy. Run the updater
separately for the authorized environment. A JSON Patch `test` prevents a stale
read from overwriting another message edit; preview again after a conflict.
For rollback, restore the prior value of this property in the theme editor,
or remove it if it was previously inherited.

Use Biome from `nix develop` to match infrastructure CI.

## Secondary-inbox login validation investigation

Keep the rejection in `templates/reconcile_secondary_idp_link.js`. On
FusionAuth 1.69.4, moving it to a login-validation lambda via a boolean in
`user.data` allows overlapping secondary-inbox attempts to receive tokens for
the primary account. Sequential tests pass and the specific error renders,
but the handoff does not isolate concurrent attempts.

The [isolated reproducer and findings](tests/README.md) exercise both the
hosted-login flow and the IdP Login API. Its experimental lambdas are test
fixtures only; neither Pulumi nor local bootstrap references them.

# TODO
- [ ] configure idps
- [ ] sync prod with pulumi stack
