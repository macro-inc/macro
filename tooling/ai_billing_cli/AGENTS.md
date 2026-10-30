# ai_billing_cli

## What it is

Operator CLI for AI billing (`ai-billing`). `grant-credits` adds prepaid AI
credit to the account that pays for a user, e.g. to refund usage. The use case
lives in `crates/ai_billing` (`domain/credit_grant.rs`); this binary only
parses arguments and prints.

## Recipes

- Dry run, then book with the id it printed:

  ```bash
  DATABASE_URL=... cargo run -p ai_billing_cli -- grant-credits \
    --user 'macro|someone@example.com' --amount-cents 1500 \
    --reason 'refund of October usage, by <you>'
  # ...then the same command plus --execute --grant-id <printed id>
  ```

- Prod: use the `DATABASE_URL` from Doppler `global_databases` / `prd`. The
  database only accepts allowlisted IPs (security group `macrodb-sg-prod`),
  such as the NYC office; elsewhere, tunnel through an allowlisted machine.
  Writing to prod needs explicit permission (root `CLAUDE.md`).

## Checks

- `cargo test -p ai_billing credit_grant` (`SQLX_OFFLINE` unset).

## Gotchas

- Credit is in customer cents and funds only usage beyond a paid plan's
  allowance, at the overage markup (`AI_USAGE_OVERAGE_MARKUP_PERCENT`): $15 of
  credit covers $12 of usage at a 25% markup. It does not reset the allowance,
  and free users are refused (they are hard-capped).
- `--user` takes the billing id `macro|<email>`, not the `macro_user` UUID.
