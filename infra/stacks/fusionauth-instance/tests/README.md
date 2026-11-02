# Secondary-inbox reconciliation → validation investigation

The proposed `user.data` handoff is unsafe on FusionAuth **1.69.4**. Keep the
existing rejection in `templates/reconcile_secondary_idp_link.js`. No deployment
or local-bootstrap configuration points at the experimental fixtures here.

## What the experiment establishes

The upstream fixture returns two synthetic OIDC identities linked to one
FusionAuth user. One identity's email matches the primary email; the other is a
secondary inbox. The candidate reconciliation lambda compares the same UserInfo
email with the FusionAuth user's email and writes a boolean to `user.data`.
The candidate login validator reads that boolean from its `user` argument,
scoped to `OPENID_CONNECT` and `google_gmail`, and returns
`[SecondaryInboxLogin]` with recovery guidance when it is false. Missing or
malformed decisions fail closed. The validator does not fetch the user from an
API.

Sequential attempts show that the handoff reaches validation and its named error
renders on the real hosted-login page. Missing/malformed email claims reject;
a primary login after a rejection succeeds. Password, passwordless, another
OIDC provider, refresh, and an existing session continue to work despite the
persisted rejection flag.

Overlapping attempts invalidate the design. A barrier releases the matching
and mismatching UserInfo responses together. Some secondary attempts receive a
primary-account token; some primary attempts receive the secondary-inbox error.
The reproducer verifies issued tokens with FusionAuth's `/api/jwt/validate`
and checks that their subject is the primary user. The browser case uses two
fresh contexts, traverses `/oauth2/authorize` and the IdP callback, and exchanges
any incorrectly issued secondary authorization code at `/oauth2/token` before
validating the resulting token.

This establishes that the boolean supplied to validation is not reliably tied
to its own authentication attempt. It does not establish FusionAuth's internal
object/cache/transaction mechanism. In particular, the separate report about
concurrent PATCH lost updates is not the evidence for this finding.

The original reconciliation rejection is the control: the same overlapping
identities remain blocked when the email comparison throws directly.

## Observed run (1.69.4)

An isolated run with the existing dev theme copied locally produced:

| Check | Result |
| --- | --- |
| Concurrent secondary IdP API logins | **18/50 issued valid primary-account tokens** |
| Concurrent primary IdP API logins | 30/50 incorrectly rejected |
| Concurrent secondary hosted logins | **2/20 issued exchangeable authorization codes** |
| Original guard, concurrent secondary logins | 20/20 rejected |
| Sequential error, retry, missing/malformed email | Expected behavior |
| Password, passwordless, other OIDC, refresh, existing session | Continued working |
| Error at desktop and 390px mobile width | Readable; no horizontal overflow or primary-email disclosure |

Google itself is replaced by a synthetic upstream OIDC provider; FusionAuth's
hosted pages, reconciliation, validation, sessions, authorization-code exchange,
and JWT validation are real. No hosted configuration was changed. These results
reject the proposed handoff; they do not certify the larger auth system.

## Run it

From the repository root, install the workspace dependencies (`bun install`)
and Playwright Chromium (`bunx playwright install chromium`) if needed. Use
Node 22 or newer and Docker Compose with `--wait` support:

```sh
node infra/stacks/fusionauth-instance/tests/reproduce-handoff-race.mjs
```

The script creates a uniquely named Compose project, a fresh tmpfs PostgreSQL
database, FusionAuth pinned to 1.69.4, and a synthetic OIDC server. FusionAuth
binds only to a random loopback port. The synthetic provider listens on a random
host port so both Chromium and Docker's `host.docker.internal` can reach it;
it contains no real credentials or account data. It requires no Google account,
FusionAuth license, hosted environment, or Macro app stack.

Only its own FusionAuth container is restarted after fixture configuration to
avoid testing partially propagated configuration caches. The script removes
its own containers/network at exit and keeps screenshots in the printed temp
directory. It does not start, stop, or reset any existing local stack.

`UNSAFE` counts are counterexamples, not successful security checks. The script
exits successfully only if the API and browser races reproduce, the issued
tokens validate for the primary user, and the original guard remains effective.
Race counts depend on scheduling. Failure to reproduce in a particular run is
not proof of safety. Timeouts and unrelated errors fail the run.

By default, screenshots use FusionAuth's bundled theme. To check an existing
layout, supply a previously exported **theme object** (not a `{theme: ...}`
wrapper), with `id`, `insertInstant`, and `lastUpdateInstant` removed:

```sh
FUSIONAUTH_TEST_THEME=/absolute/path/to/theme.json \
  node infra/stacks/fusionauth-instance/tests/reproduce-handoff-race.mjs
```

The script imports that object only into its new local instance. It performs no
hosted reads or writes. Never commit exported themes or verification captures.

## Implications

Do not replace the reconciliation throw with this boolean, a timestamp, or a
single persisted nonce. Login-validation context identifies the provider and
authentication type but does not provide a documented shared attempt identifier
with which to bind the decision. A timestamp narrows a window without removing
the race; a nonce stored only on the user cannot identify which attempt is
being validated.

An account-wide sticky denial could avoid some false allows, but would reject
legitimate primary logins and violate retry/session requirements. It is not a
replacement for an attempt-scoped decision.

Any future two-lambda design needs a documented, verified attempt binding and
the same concurrency/token checks before removing the guard. Otherwise, an
owned OAuth callback can verify the external identity and reject secondary
inboxes before creating the FusionAuth session. That is a separate auth-flow
change requiring design and validation; this investigation does not implement
it. Keep the existing conditional recovery message in the meantime.

There is also a rollout hazard: API configuration writes can become readable
before all login paths use the new configuration. Updating the tenant validator
and reconciliation back-to-back briefly allowed secondary logins in the local
probe. Resource dependency order alone does not prove the validator is active.
This is separate from the steady-state race reproduced after a restart.

## Sources

- [FusionAuth's suggested handoff](https://github.com/FusionAuth/fusionauth-issues/issues/952#issuecomment-4402978130)
- [Reconciliation inputs](https://fusionauth.io/docs/extend/code/lambdas/reconcile/openid-connect-response-reconcile)
- [Validation context and named errors](https://fusionauth.io/docs/extend/code/lambdas/login-validation)
- [Hosted IdP error propagation fix, 1.53.3](https://github.com/FusionAuth/fusionauth-issues/issues/2903)
- [Separate concurrent PATCH report](https://github.com/FusionAuth/fusionauth-issues/issues/3206)
