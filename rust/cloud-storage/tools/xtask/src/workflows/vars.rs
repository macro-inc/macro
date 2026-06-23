//! Shared workflow environment: secrets, the repo-wide env block, concurrency,
//! and the sccache-on-volume settings. This is the "environment" file.

use gh_workflow::{Concurrency, Expression, Workflow};

/// Declares a `${{ secrets.NAME }}` reference as a `&str` const named `NAME`, so
/// secret usage is greppable and typo-proof.
macro_rules! secret {
    ($name:ident) => {
        pub const $name: &str = concat!("${{ secrets.", stringify!($name), " }}");
    };
}

secret!(CACHIX_AUTH_TOKEN);
secret!(DOPPLER_TOKEN);

/// Nextest thread count for the test job. Tuned for the previous
/// `linux-extra-beefy` runner; revisit if `namespace-profile-linux-mid` is
/// smaller.
pub const NEXTEST_TEST_THREADS: u32 = 32;

/// Explicit Namespace cache tag for the heavy compile jobs (check + test). A
/// fixed tag (instead of the default per-branch scoping) makes the cache volume
/// global across all branches — see [`crate::workflows::runners::Runner::with_cache_tag`].
pub const CI_CACHE_TAG: &str = "sccache-ci";

/// Directory sccache uses for its local-disk cache. Lives on the Namespace cache
/// volume so it persists across runs — this is what replaces the S3 bucket.
pub const SCCACHE_VOLUME_DIR: &str = "/sccache";

/// Max on-disk size for the sccache cache. Larger than the setup default since
/// the persisted volume can hold a full-workspace cache.
pub const SCCACHE_CACHE_SIZE: &str = "20G";

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
