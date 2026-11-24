//! Shared workflow environment: secrets, the repo-wide env block, concurrency,
//! and Namespace cache names. This is the "environment" file.

use gh_workflow::expr::typed::{Secret, Var, github};
use gh_workflow::{Concurrency, Workflow};

/// Declares a secret as a [`Secret`] const named `NAME`, so secret usage is
/// greppable and typo-proof; it renders `${{ secrets.NAME }}`.
macro_rules! secret {
    ($name:ident) => {
        pub const $name: Secret = Secret(stringify!($name));
    };
}

secret!(APPETIZE_API_TOKEN);
secret!(ANDROID_RELEASE_DOPPLER_TOKEN);
secret!(AWS_ACCESS_KEY);
secret!(AWS_SECRET_ACCESS_KEY);
secret!(CLA_CHECK_API_KEY);
secret!(CLA_ORG_READ_TOKEN);
secret!(CLOUDFLARE_API_TOKEN);
secret!(CONNECTORS_E2E_ALERT_BOT_TOKEN);
secret!(CONNECTORS_E2E_FLAGGED_API_KEY);
secret!(CONNECTORS_E2E_UNFLAGGED_API_KEY);
secret!(DAYTONA_API_KEY);
secret!(DD_API_KEY);
secret!(DD_APP_KEY);
secret!(DOPPLER_TOKEN);
secret!(GITHUB_TOKEN);
secret!(IOS_RELEASE_DOPPLER_TOKEN);
secret!(MACOS_DEVELOPER_ID_CERTIFICATE_BASE64);
secret!(MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD);
secret!(MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64);
secret!(MACOS_RELEASE_DOPPLER_TOKEN);
secret!(MACRO_BUILD_ALERT_BOT_TOKEN);
secret!(NIX_CACHE_SIGNING_KEY);
secret!(POSTHOG_API_KEY);
secret!(PULUMI_ACCESS_TOKEN);
secret!(SEGMENT_WRITE_KEY);
secret!(SEGMENT_WRITE_KEY_PRODUCTION);

/// Webhook that posts to the Macro Alerts channel, a repo *variable*; it takes
/// [`MACRO_BUILD_ALERT_BOT_TOKEN`] in an `x-macro-channel-bot-token` header.
/// [`super::alert_native_build_failures`] posts there too.
pub const MACRO_BUILD_ALERT_WEBHOOK_URL: Var = Var("MACRO_BUILD_ALERT_WEBHOOK_URL");

/// Webhook of the Macro channel the connectors end-to-end suite reports its
/// failures to, a repo *variable*; it takes [`CONNECTORS_E2E_ALERT_BOT_TOKEN`]
/// in an `x-macro-channel-bot-token` header ([`super::connectors_e2e`]).
pub const CONNECTORS_E2E_ALERT_WEBHOOK_URL: Var = Var("CONNECTORS_E2E_ALERT_WEBHOOK_URL");

/// What the connectors suite's test accounts hold, repo *variables*
/// (`crates/connectors_e2e/AGENTS.md`): an app the flagged account connected
/// through Macro Connect, an app the unflagged account connected through
/// Pipedream, whether the unflagged account linked GitHub, an MCP server that
/// needs no sign-in, and a Notion page to import.
pub const CONNECTORS_E2E_CONNECT_APP: Var = Var("CONNECTORS_E2E_CONNECT_APP");
/// See [`CONNECTORS_E2E_CONNECT_APP`].
pub const CONNECTORS_E2E_PIPEDREAM_APP: Var = Var("CONNECTORS_E2E_PIPEDREAM_APP");
/// See [`CONNECTORS_E2E_CONNECT_APP`].
pub const CONNECTORS_E2E_GITHUB_LINKED: Var = Var("CONNECTORS_E2E_GITHUB_LINKED");
/// See [`CONNECTORS_E2E_CONNECT_APP`].
pub const CONNECTORS_E2E_MCP_SERVER_URL: Var = Var("CONNECTORS_E2E_MCP_SERVER_URL");
/// See [`CONNECTORS_E2E_CONNECT_APP`].
pub const CONNECTORS_E2E_NOTION_PAGE: Var = Var("CONNECTORS_E2E_NOTION_PAGE");

/// Workload identity provider that lets CI authenticate to Google Play, a
/// repo *variable*.
pub const GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER: Var =
    Var("GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER");

/// Service account CI acts as on Google Play, a repo *variable*.
pub const GOOGLE_PLAY_SERVICE_ACCOUNT: Var = Var("GOOGLE_PLAY_SERVICE_ACCOUNT");

/// Cloudflare account id. A repo *variable* (not a secret).
pub const CLOUDFLARE_ACCOUNT_ID: Var = Var("CLOUDFLARE_ACCOUNT_ID");

/// S3 nix binary cache store URL, a repo *variable* — e.g.
/// `s3://macro-nix-cache?region=us-east-1`. The substituter role Cachix used
/// to play: any /nix cache-volume miss becomes a signed-narinfo download
/// instead of a from-source rebuild. Empty/unset disables all nix-cache
/// wiring (setup skips the substituter config; push steps no-op), so the
/// workflows are safe to run before the bucket exists.
pub const NIX_CACHE_URL: Var = Var("NIX_CACHE_URL");

/// Public counterpart of [`NIX_CACHE_SIGNING_KEY`], a repo *variable* — e.g.
/// `nix-cache.macro.com-1:BASE64...`. Trusted by the nix daemon so substituted
/// paths verify.
pub const NIX_CACHE_PUBLIC_KEY: Var = Var("NIX_CACHE_PUBLIC_KEY");

/// Limit on entering the Nix dev shell. Healthy runs take under 9 minutes even
/// from an empty cache volume, while a stalled store download has run for over
/// an hour with no other limit to stop it.
pub const DEV_SHELL_TIMEOUT_MINUTES: u32 = 15;

/// Nextest thread count for the test job, one per vCPU of [`Runner::Large`].
///
/// [`Runner::Large`]: crate::workflows::runners::Runner::Large
pub const NEXTEST_TEST_THREADS: u32 = 32;

/// Explicit Namespace cache-volume tag for the heavy compile jobs (check +
/// test), apart from the profile's default volume — see
/// [`crate::workflows::runners::Runner::with_cache_tag`]. The legacy tag name is
/// retained so the existing warm volume is not invalidated.
pub const CI_CACHE_TAG: &str = "sccache-ci";

/// Namespace remote sccache shared by the cloud-storage compile/test jobs and
/// the workspace dependency checks.
pub const CI_SCCACHE_NAME: &str = "sccache-ci";

/// Namespace cache tag for the web-app jobs: PR checks, preview deploys, and
/// the web build and deploy jobs of dev and prod deploys. Cache volumes are
/// keyed workspace-wide by tag alone, so a dedicated tag gives the frontend its
/// own volume — isolated both from the Rust CI volume ([`CI_CACHE_TAG`]) and
/// from the other deploy workflows' heavily-churned default `linux-mid`
/// volume.
pub const WEB_CI_CACHE_TAG: &str = "web-ci";

/// Nix-only PR checks. They read a Nix store back, so they stay off the small
/// profile's default volume, where other jobs would overwrite that store.
pub const NIX_CHECKS_CACHE_TAG: &str = "nix-checks";

/// Namespace cache tag and remote sccache for the desktop app check
/// (`desktop_check.rs`). Its own volume, because it holds the Tauri Linux
/// libraries no other job needs, and PR jobs write it, so no release build may
/// share it.
pub const DESKTOP_CI_CACHE: &str = "desktop-ci";

/// Namespace remote sccache used when the web checks compile Rust API schema
/// generators. Kept separate from [`CI_SCCACHE_NAME`] because these jobs have
/// a different workload and runner profile.
pub const WEB_SCCACHE_NAME: &str = "web-ci";

/// Namespace cache tag for the web Generated Code Check alone. Its volume keeps
/// cargo's `target` directory ([`cargo_target_volume_dir`]) and the times its
/// sources' contents first appeared. The last job to finish on a tag replaces the
/// volume, so on a shared tag another job would put back a `target` that never
/// saw this job's build.
pub const WEB_CODEGEN_CACHE_TAG: &str = "web-codegen";

/// Cargo's `target` directory, kept on the [`WEB_CODEGEN_CACHE_TAG`] volume and
/// made reusable by `steps::reuse_cargo_target`.
pub fn cargo_target_volume_dir() -> String {
    format!("{}/target", github().workspace())
}

/// Namespace cache tag for the sync-service worker deploy. Its own pool: this
/// job compiles for `wasm32-unknown-unknown`, so nothing in the host-target
/// volumes ([`CI_CACHE_TAG`]) would serve it anyway.
pub const SYNC_SERVICE_CACHE_TAG: &str = "sync-service-deploy";

/// Bun's global package cache. Mounted explicitly because Bun is supplied by
/// the Nix dev shell and is not available to Namespace's cache planner yet.
pub const BUN_CACHE_VOLUME_DIR: &str = "/home/runner/.bun/install/cache";

/// Vitest's filesystem module cache for the web `Test` job. `apps/web`'s
/// Vitest config reads it from `VITEST_MODULE_CACHE_DIR` and keys entries by
/// the lockfile and tsconfig, so PR jobs can share one volume.
pub const VITEST_MODULE_CACHE_VOLUME_DIR: &str = "/home/runner/.cache/vitest-modules";

/// Browser wasm packages keyed by their inputs, so the PR build reuses a package
/// whose crates did not change (`apps/web/scripts/cached-wasm-build.sh`).
pub const WASM_PKG_CACHE_DIR: &str = "/home/runner/.cache/wasm-pkgs";

/// The workspace's root `node_modules`, kept on the PR check volumes. Bun can't
/// hardlink from its cache on the volume into the workspace disk, so a fresh
/// install copied about 1.9 GB in every web job (about 25 s); with the tree in
/// place, `bun install --frozen-lockfile` only checks it against `bun.lock` and
/// fixes what differs. Bun never removes a package the lockfile dropped, so
/// `setup-reqs-web` empties a tree another lockfile installed. PR jobs write it, so no job that deploys, the web PR
/// Build with its preview credentials included, mounts it.
pub fn node_modules_volume_dir() -> String {
    format!("{}/node_modules", github().workspace())
}

/// The deploy build's wasm packages, kept in a GitHub Actions cache rather than
/// on the cache volume, which PR jobs write. Off the volume on purpose.
pub const DEPLOY_WASM_PKG_CACHE_DIR: &str = "/home/runner/.cache/wasm-pkgs-deploy";

/// GHCR repository for the agent-harness sandbox image (the same Dockerfile
/// Daytona snapshots). Pushed as `:$SHA` on PRs and `:$SHA` + `:latest` on main.
pub const AGENT_HARNESS_GHCR_IMAGE: &str = "ghcr.io/macro-inc/macro-agent-harness";

/// The repo-wide env block (mirrors the original top-level `env:`). Defaults the
/// linker to `lld`; the heavy jobs override `RUSTFLAGS` to use `mold`.
pub fn with_global_env(workflow: Workflow) -> Workflow {
    workflow
        .add_env(("CARGO_INCREMENTAL", "0"))
        .add_env(("CARGO_TERM_COLOR", "always"))
        .add_env(("CARGO_PROFILE_DEV_DEBUG", "limited"))
        .add_env(("CARGO_PROFILE_TEST_DEBUG", "limited"))
        .add_env(("RUST_BACKTRACE", "1"))
        .add_env(("RUSTFLAGS", "-C link-arg=-fuse-ld=lld"))
}

/// Cancel superseded runs of this workflow on the same git ref. When `PR CI`
/// calls the workflow, the group is that run's own, because `PR CI` cancels
/// its own superseded runs.
pub fn concurrency(prefix: &str) -> Concurrency {
    let run_or_ref = github()
        .event_name()
        .eq("pull_request")
        .then_else(github().run_id(), github().git_ref());
    Concurrency::new(format!("{prefix}-{run_or_ref}")).cancel_in_progress(true)
}
