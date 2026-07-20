//! Shared workflow environment: secrets, the repo-wide env block, concurrency,
//! and Namespace cache names. This is the "environment" file.

use gh_workflow::{Concurrency, Expression, Workflow};

/// Declares a `${{ secrets.NAME }}` reference as a `&str` const named `NAME`, so
/// secret usage is greppable and typo-proof.
macro_rules! secret {
    ($name:ident) => {
        pub const $name: &str = concat!("${{ secrets.", stringify!($name), " }}");
    };
}

secret!(AWS_ACCESS_KEY);
secret!(AWS_SECRET_ACCESS_KEY);
secret!(CACHIX_AUTH_TOKEN);
secret!(CLOUDFLARE_API_TOKEN);
secret!(DD_API_KEY);
secret!(DD_APP_KEY);
secret!(DD_WEB_APP_TOKEN);
secret!(DOPPLER_PREVIEW_TOKEN);
secret!(DOPPLER_TOKEN);
secret!(FLY_API_TOKEN);
secret!(MACOS_DEVELOPER_ID_CERTIFICATE_BASE64);
secret!(MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD);
secret!(POSTHOG_API_KEY);
secret!(PULUMI_ACCESS_TOKEN);
secret!(SEGMENT_WRITE_KEY);
secret!(SEGMENT_WRITE_KEY_PRODUCTION);

/// Cloudflare account id. A repo *variable* (not a secret), matching the
/// hand-written `deploy-lexical-service.yml`.
pub const CLOUDFLARE_ACCOUNT_ID: &str = "${{ vars.CLOUDFLARE_ACCOUNT_ID }}";

/// Nextest thread count for the test job. Tuned for the previous
/// `linux-extra-beefy` runner; revisit if `namespace-profile-linux-mid` is
/// smaller.
pub const NEXTEST_TEST_THREADS: u32 = 32;

/// Explicit Namespace cache-volume tag for the heavy compile jobs (check +
/// test). A fixed tag (instead of the default per-branch scoping) makes the
/// Cargo/Nix volume global across all branches — see
/// [`crate::workflows::runners::Runner::with_cache_tag`]. The legacy tag name is
/// retained so the existing warm volume is not invalidated.
pub const CI_CACHE_TAG: &str = "sccache-ci";

/// Namespace remote sccache shared by the cloud-storage compile/test jobs and
/// the workspace dependency checks.
pub const CI_SCCACHE_NAME: &str = "sccache-ci";

/// Namespace cache tag for the Fly preview deploy job. Its own pool, NOT
/// [`CI_CACHE_TAG`]: sharing looked economical but was measured cold both ways
/// (run 28968155599: sccache 2.65% hits, cargo target dir absent). The
/// check/test jobs compile for the host while this job zigbuilds with
/// `--target x86_64-unknown-linux-gnu.2.36`, so their sccache entries hash
/// differently and never serve this job — and they don't persist the cargo
/// target dir at all, so a volume from the shared pool almost never carries
/// one. A dedicated low-concurrency pool gives the job's target dir and init
/// snapshots the best chance of a zero-copy hit; Rust objects use the durable
/// remote sccache below instead of depending on this volume's placement.
pub const PREVIEW_CACHE_TAG: &str = "fly-preview";

/// Durable Namespace remote sccache shared by Fly preview jobs. Unlike the
/// local cache volume, this has an artifact-backed cold tier, so a job placed
/// on a runner that has never seen the volume can still reuse Rust objects.
pub const PREVIEW_SCCACHE_NAME: &str = "fly-preview";

/// Namespace cache tag for the web-app jobs (PR checks + preview deploys).
/// Cache volumes are keyed workspace-wide by tag alone, so a dedicated tag
/// gives the frontend its own volume — isolated both from the Rust CI volume
/// ([`CI_CACHE_TAG`]) and from the deploy workflows' heavily-churned default
/// `linux-mid` volume.
pub const WEB_CI_CACHE_TAG: &str = "web-ci";

/// Namespace remote sccache used when the web checks compile Rust API schema
/// generators. Kept separate from [`CI_SCCACHE_NAME`] because these jobs have
/// a different workload and runner profile.
pub const WEB_SCCACHE_NAME: &str = "web-ci";

/// Init-snapshot store for the preview job (`MACRO_STACK_SNAPSHOT_DIR`). Lives
/// on the preview cache volume for the zero-copy fast path; the workflow also
/// backs each content-addressed snapshot up to Namespace artifact storage so a
/// cache-volume miss does not force another infra bake.
pub const PREVIEW_SNAPSHOT_VOLUME_DIR: &str = "/home/runner/.cache/macro-preview-snapshots";

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

/// Cancel superseded runs of this workflow on the same git ref.
pub fn concurrency(prefix: &str) -> Concurrency {
    Concurrency::new(Expression::new(format!("{prefix}-${{{{ github.ref }}}}")))
        .cancel_in_progress(true)
}
