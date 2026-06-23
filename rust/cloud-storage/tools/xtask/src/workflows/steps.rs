//! Reusable workflow building blocks: a small fluent-builder trait plus typed
//! helpers that return `Step`s and `Job`s, composed by the workflow files.
//!
//! Third-party actions are pinned to a SHA with the human-readable version in a
//! trailing comment, matching the rest of the repo's workflows.

use gh_workflow::{Expression, Job, Run, Step, Use};

use crate::workflows::vars;

/// `.map` / `.when` combinators for fluent conditional composition
/// ("push ifs up"): centralize branching in the builder chain instead of
/// building values imperatively.
pub trait FluentBuilder: Sized {
    /// Apply `f` to `self`.
    fn map<U>(self, f: impl FnOnce(Self) -> U) -> U {
        f(self)
    }
    /// Apply `f` only when `cond` holds.
    fn when(self, cond: bool, f: impl FnOnce(Self) -> Self) -> Self {
        if cond {
            f(self)
        } else {
            self
        }
    }
}

impl FluentBuilder for gh_workflow::Workflow {}
impl FluentBuilder for Job {}
impl<T> FluentBuilder for Step<T> {}

/// Reference a repo-local composite action (`uses: ./path`). The base
/// `gh-workflow` `uses()` only builds `owner/repo@version`, so we set the raw
/// `uses` field directly. Kept in one place so the workaround is contained.
fn uses_local(name: &str, path: &str) -> Step<Use> {
    let mut step = Step::new(name).uses("local", "local", "0");
    step.value.uses = Some(path.to_string());
    step
}

/// `actions/checkout`, pinned. `full_history` fetches the full history, which the
/// path-filter diff in `path-check` needs.
pub fn checkout(full_history: bool) -> Step<Use> {
    Step::new("Checkout")
        .uses(
            "actions",
            "checkout",
            "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        ) // v4
        .add_with(("clean", false))
        .when(full_history, |step| step.add_with(("fetch-depth", 0)))
}

/// Install the Rust toolchain only (no sccache, no cache) — for the lightweight
/// `path-check` and workflow-drift jobs.
pub fn setup_rust_light() -> Step<Use> {
    uses_local("Setup Rust", "./.github/actions/setup-rust")
        .add_with(("sccache", "false"))
        .add_with(("rust-cache", "false"))
}

/// Install + initialise Nix on the runner. Namespace profiles don't ship Nix,
/// so this must run before [`setup_dev_shell`] (which shells out to `nix`). The
/// `/nix` cache volume mounted by [`mount_cache_volume`] keeps the store warm,
/// so it re-inits the daemon rather than doing a full install.
pub fn setup_nix() -> Step<Use> {
    uses_local("Setup Nix", "./.github/actions/setup-nix")
}

/// Enter the repo's Nix dev shell (toolchain, mold, just, the sccache binary,
/// and `RUSTC_WRAPPER=sccache`). We pass NO `sccache-bucket`, so sccache runs in
/// local-disk mode instead of talking to S3. Requires [`setup_nix`] first.
pub fn setup_dev_shell() -> Step<Use> {
    uses_local("Setup Nix dev shell", "./.github/actions/setup-cachix")
        .add_with(("cachix-auth-token", vars::CACHIX_AUTH_TOKEN))
        .add_with(("dev-shell", "true"))
}

/// Mount the Namespace profile's persisted cache volume: `cache: rust` persists
/// the cargo registry/git, and `path:` persists the sccache dir plus the Nix
/// store. `continue-on-error` because the cache is a pure optimization — a
/// missing/failed volume just means a cold build, never a wrong one (mirrors the
/// deploy workflows' `/nix` mounts).
pub fn mount_cache_volume() -> Step<Use> {
    Step::new("Mount Namespace cache volume")
        .uses(
            "namespacelabs",
            "nscloud-cache-action",
            "15799a6b54e5765f85b2aac25b3f0df43ed571c0", // v1.4.3
        )
        .add_with(("cache", "rust"))
        .add_with(("path", format!("{}\n/nix", vars::SCCACHE_VOLUME_DIR)))
        .continue_on_error(true)
}

/// Repoint sccache at the persisted volume. Runs AFTER `setup-cachix`, which
/// writes `SCCACHE_DIR=$HOME/.cache/sccache` to `$GITHUB_ENV`; this overrides it
/// for the cargo steps so compilation artifacts land on the sticky volume.
pub fn pin_sccache_dir() -> Step<Run> {
    Step::new("Point sccache at the cache volume").run(format!(
        "echo \"SCCACHE_DIR={dir}\" >> \"$GITHUB_ENV\"\n\
         echo \"SCCACHE_CACHE_SIZE={size}\" >> \"$GITHUB_ENV\"",
        dir = vars::SCCACHE_VOLUME_DIR,
        size = vars::SCCACHE_CACHE_SIZE,
    ))
}

/// `sccache --show-stats` at the end of a job (never fails the job).
pub fn show_sccache_stats() -> Step<Run> {
    Step::new("show sccache stats")
        .run("sccache --show-stats || true")
        .if_condition(Expression::new("always()"))
}

/// Base for jobs gated behind `path-check`: depends on it and runs only on
/// non-draft PRs where the path filter matched. Shared by `check` and `test`.
pub fn gated_job() -> Job {
    Job::default()
        .needs(vec!["path-check".to_string()])
        .cond(Expression::new(
        "needs.path-check.outputs.should_run == 'true' && github.event.pull_request.draft == false",
    ))
}
