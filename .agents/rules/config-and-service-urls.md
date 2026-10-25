---
description: Configuration, env vars, secrets, and service URLs each have one source per runtime; never invent env vars or hardcode hosts.
globs:
alwaysApply: true
---

# Configuration and service URLs

Config has exactly one source per runtime. Do not add a second one "just in case",
read a plain env var as a fallback, or hardcode a host. A missing value fails
startup loudly.

## Rust services

- **CS-14** Read config only through `macro_config::MacroConfig` fields and the
  `macro_env_var` macros: `env_vars!` for required, `maybe_env_vars!` for
  optional. `std::env::var` is banned by clippy. Use `macro_aws_config` and
  `macro_entrypoint` for AWS and tracing setup.
- **CS-15** Load config once at startup (`ConfigLoader::load`), never inside
  handlers.
- **CS-16** Don't add `.context()` to env-var macro errors; they already name
  the var.
- **CS-17** Doppler key names equal the env var names in code, exactly.
- **CS-18** Every new value goes into Doppler: the service project's `dev` and
  `prd` configs (CI's `doppler_config` check fails otherwise) and
  `local/lcl_personal`, plus a `BootStubEnv` placeholder in `xtask_local` so
  `--no-doppler` still boots.
- In ECS the whole Doppler config arrives as `APP_SECRETS_JSON`, and
  `MacroConfig` reads **only** that JSON when it is present. A Pulumi container
  `environment:` entry is invisible to `MacroConfig`; a value that comes from
  infra must be written into Doppler (see `infra/stacks/preview-gateway`).

## Service URLs

- Stable service URLs and public OAuth/callback/app origins are typed in
  `crates/macro_service_urls` (`service_url!` with `local`/`dev`/`prod`), chosen by `ENVIRONMENT`. Call
  `XServiceUrl::new()`. Never declare a `FOO_SERVICE_URL` env var or match on
  `Environment` to build a URL. Queue names follow the same pattern in
  `crates/macro_queues`.
- The only override is `OVERRIDE_<SNAKE_NAME>`, read from the process
  environment, not from Doppler. Local in-network overrides live in
  `xtask_local`'s `local_env.rs`; `local` defaults are host ports and do not
  work inside Docker.
- The URL table is hand-copied. A new or changed service URL updates every copy:
  `macro_service_urls` and `infra/packages/shared/src/service_urls.ts`, plus each
  consuming runtime (`apps/web/src/lib/core/constant/servers.ts`,
  `packages/sdk/src/config.ts`, and worker `[env.*.vars]`). Do not add unused
  public OAuth identities to API transport maps.
- Keep registered public OAuth identities separate from internal gateway API
  routes. Do not store stable URLs in Doppler; reserve it for secrets and
  infrastructure-generated addresses (such as preview DNS and SSH hosts).
- When removing required Doppler URL fields, retain their existing values until
  the deployed rollback baseline no longer requires them; migrate consumers to
  typed URLs before deleting compatibility resources.

## Other runtimes

- **Web app:** service hosts come from `SERVER_HOSTS` in `servers.ts`; app
  origin from `getWebOrigin`. Feature switches use `defineFlag` (see the
  `feature-flags` skill), not raw `VITE_ENABLE_*` reads. Declare new
  `VITE_*` vars in `src/vite-env.d.ts`.
- **Cloudflare workers:** non-secret config goes in every `[env.*.vars]` block
  of `wrangler.toml`/`.jsonc` (named envs don't inherit) and
  `wrangler.docker.toml`; secrets via `wrangler secret put`; type them in the
  worker's env module.

Details: [new service guide](../../docs/guides/new-service.md),
[infrastructure guide](../../docs/development/infrastructure.md).
