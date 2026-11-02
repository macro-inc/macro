# FusionAuth instance

## Scope

Pulumi configuration and JavaScript lambdas for the hosted identity service.
Local bootstrap also reads the deployed reconciliation template from
`tooling/xtask/crates/xtask_local/src/local/fusionauth.rs`.

## Checks

- `bun run --cwd infra check`
- `just check`
- For reconciliation/validation changes, run the isolated reproduction in
  `tests/README.md` and exercise the real hosted-login flow.

## Gotchas

- Keep secondary-inbox rejection in reconciliation; the `user.data` handoff
  fails under concurrent logins on 1.69.4 (see `tests/README.md`).
- Never deploy lambdas from `tests/fixtures/`; they intentionally reproduce an
  unsafe authentication policy.
- Use block comments in kickstart lambda templates; KickstartRunner flattens
  their bodies onto one line.
- Hosted theme and tenant changes require separate authorization. The race
  reproducer creates its own disposable Docker project and uses synthetic data.
