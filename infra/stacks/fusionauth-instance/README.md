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

`theme-message.ts` owns the `[IdentityProviderValidationException]` copy and
the existing dev/prod theme IDs. The copy offers conditional recovery guidance
for an additional Gmail inbox; the error code also covers other IdP failures.
It does not change the reconciliation lambda, account linking, or login policy.

The existing advanced themes are not managed as complete Pulumi resources.
Use the focused updater instead of importing or replacing a full theme:

```sh
# From this directory: read-only preview, using the stack's existing credentials.
bun update-theme-message.ts dev
bun update-theme-message.ts prod

# Only after explicit authorization for the target environment:
bun update-theme-message.ts dev --apply
bun update-theme-message.ts prod --apply
```

Merging this code or deploying the Pulumi stack does **not** apply the message.
An authorized operator must run the updater separately. It reads `fusionauth:host`
and `fusionauth:apiKey` from the selected Pulumi stack without logging the key.
The theme API is global; do not add an `X-FusionAuth-TenantId` header.

The updater preserves existing message text and patches only `defaultMessages`,
adding the key when the theme inherits it. A JSON Patch `test` rejects a changed
message bundle before replacement; rerun the preview after a conflict. Existing
escaped brackets are supported, while ambiguous, duplicate, continued, or
localized definitions of this key require manual review. Templates, styles,
localized bundles, and theme assignments remain outside this updater's scope.
See the [FusionAuth theme API](https://fusionauth.io/docs/apis/themes/advanced-themes)
and [JSON Patch documentation](https://fusionauth.io/docs/apis/#the-patch-http-method).

Before applying, record any existing value for this key. To roll back, restore
only that property in the theme message editor, or remove it if it was inherited.
Do not restore a full theme snapshot over later changes. Verify a failed IdP
sign-in on `/oauth2/authorize` after applying or rolling back; it should remain
blocked and display the intended message.

Run `bun test theme-message.test.ts` for the properties-preservation checks.

# TODO
- [ ] configure idps
- [ ] sync prod with pulumi stack
