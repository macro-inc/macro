# Authentication Service Configuration

## Development signup allowlist

The authentication service gates new signups with a startup-built `SignupPolicy`.
The policy is enforced authoritatively by the existing FusionAuth `user.create`
webhook at `/webhooks/user`. FusionAuth is configured for `user.create` with
`AbsoluteMajority`, so a non-2xx response from this service rejects the
transaction and aborts FusionAuth user creation.

Public prechecks in user creation and passwordless signup exist only for a
faster user-facing `403` response. They are advisory. The transactional webhook
is the enforcement boundary for all signup paths, including SSO and future
FusionAuth-created users.

### Setting

- Doppler project: `authentication-service`
- Develop Doppler config: `dev`
- Production Doppler config: `prd`
- Setting name: `DEVELOPMENT_SIGNUP_ALLOWLIST_JSON`
- Format: JSON array of exact email-address strings

Synthetic example only:

```json
["allowed.user@example.com", "second.user@example.net"]
```

Do not commit or paste operational allowlist values into source, docs, logs, PRs,
or generated files.

### Environment behavior

| Runtime environment | Doppler slug | Effective signup policy |
| --- | --- | --- |
| `Environment::Develop` | `dev` | Requires `DEVELOPMENT_SIGNUP_ALLOWLIST_JSON` to be present, nonblank, valid, and non-empty. |
| `Environment::Production` | `prd` | Allows all public signups. The allowlist setting is ignored even if present or malformed. |
| `Environment::Local` | `lcl` | Allows all public signups. The allowlist setting is ignored even if present or malformed. |

Develop startup fails if the setting is missing, blank, malformed JSON, not a
JSON array, empty, contains a non-string entry, contains a blank entry, or
contains an invalid email address. Production and Local do not require the
setting and do not parse it.

### Matching and validation semantics

The allowlist is parsed once at service startup and stored in memory. Request
handlers perform hash lookups only.

Normalization rules:

- Trim leading and trailing whitespace from each configured entry.
- Validate each entry with the service email parser.
- Lowercase the address after validation.
- Deduplicate normalized addresses.

Matching rules:

- Matching is exact after normalization.
- Case differences do not matter.
- `+` aliases remain distinct addresses.
- Domains, wildcards, suffixes, patterns, and regular expressions are not
  supported.
- Denial responses and policy errors must not disclose configured addresses.

## Shared mailboxes

Internal shared-mailbox grant relocation creates ordinary FusionAuth users for
mailbox grants. In Develop, those mailbox addresses must be listed explicitly in
`DEVELOPMENT_SIGNUP_ALLOWLIST_JSON` before relocation creates the FusionAuth
user. There is no metadata-based signup-policy bypass for shared mailboxes.

## Rollout

1. Configure `DEVELOPMENT_SIGNUP_ALLOWLIST_JSON` in Doppler project
   `authentication-service`, config `dev`, using only the approved operational
   addresses for the deployment. Keep values out of source control and chat.
2. Validate the Doppler configs and semantic policy resolution:

   ```bash
   nix develop --command cargo check -p authentication_service --bin authentication_service_doppler_config
   ```

3. Deploy the authentication service build that contains the signup policy.
4. Restart or replace all Develop authentication service tasks. The setting is
   loaded once at startup; changing Doppler after deployment does not update
   running tasks.
5. Confirm Develop signups for allowed synthetic/test accounts succeed and
   unlisted synthetic/test accounts receive a generic `403` without onboarding
   side effects.

Production and Local remain allow-all and can deploy independently of the
Develop allowlist value.

## Rollback

- If Develop startup fails, fix the Doppler JSON value and restart the service
  tasks. The service will not accept traffic until the Develop value is valid.
- If a legitimate Develop signup is denied, add the address to the Doppler JSON
  array and restart or replace the authentication service tasks.
- If the release must be reverted, roll Develop back to the previous
  authentication service deployment or task definition. Keep a valid Develop
  allowlist configured so the forward version can be redeployed safely.

## Focused verification

Useful checks after editing signup configuration behavior:

```bash
nix develop --command env -u DATABASE_URL cargo test -p authentication_service --bin authentication_service config::test
nix develop --command cargo check -p authentication_service --bin authentication_service_doppler_config
cargo fmt --check
```

Review this README and related logs before rollout to confirm they contain only
placeholders or reserved synthetic examples, never operational email addresses
or copied Doppler values.
