//! Reusable workflow building blocks: a small fluent-builder trait plus typed
//! helpers that return `Step`s and `Job`s, composed by the workflow files.
//!
//! Third-party actions are pinned to a SHA with the human-readable version in a
//! trailing comment, matching the rest of the repo's workflows.

use gh_workflow::{Env, Expression, Job, Run, Step, Use};
use xtask_paths::{RepoDir, RuntimePath};

use crate::workflows::vars;

#[cfg(test)]
mod test;

/// Namespace's sccache setup mints a short-lived workspace credential. GitHub
/// withholds repository secrets from fork PRs, but this runner-minted token is
/// not a `secrets.*` value, so enforce the equivalent trust boundary here.
const TRUSTED_NAMESPACE_SCCACHE_CONTEXT: &str = concat!(
    "(github.event_name != 'pull_request' && ",
    "github.event_name != 'pull_request_target') || ",
    "github.event.pull_request.head.repo.full_name == github.repository"
);

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
        if cond { f(self) } else { self }
    }
}

impl FluentBuilder for gh_workflow::Workflow {}
impl FluentBuilder for Job {}
impl<T> FluentBuilder for Step<T> {}

/// Reference a repo-local composite action (`uses: ./path`). The base
/// `gh-workflow` `uses()` only builds `owner/repo@version`, so we set the raw
/// `uses` field directly. Kept in one place so the workaround is contained.
pub(crate) fn uses_local(name: &str, path: RepoDir<'_>) -> Step<Use> {
    let mut step = Step::new(name).uses("local", "local", "0");
    step.value.uses = Some(format!("./{}", path.as_str()));
    step
}

/// `actions/checkout`, pinned. `full_history` fetches the full history, which
/// the path-filter diff in `path-check` needs. `persist_credentials` controls
/// whether checkout leaves the token in git config for later steps.
pub fn checkout(full_history: bool, persist_credentials: bool) -> Step<Use> {
    Step::new("Checkout")
        .uses(
            "actions",
            "checkout",
            "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        ) // v4
        .add_with(("clean", false))
        .when(full_history, |step| step.add_with(("fetch-depth", 0)))
        .when(!persist_credentials, |step| {
            step.add_with(("persist-credentials", false))
        })
}

/// Install the Rust toolchain only (no sccache, no cache) — for the lightweight
/// `path-check` and workflow-drift jobs.
pub fn setup_rust_light() -> Step<Use> {
    uses_local(
        "Setup Rust",
        xtask_paths::repo_dir!(".github/actions/setup-rust"),
    )
    .add_with(("sccache", "false"))
    .add_with(("rust-cache", "false"))
}

/// Install + initialise Nix on the runner. Namespace profiles don't ship Nix,
/// so this must run before [`setup_dev_shell`] (which shells out to `nix`). The
/// `/nix` cache volume mounted by [`mount_cache_volume`] keeps the store warm,
/// so it re-inits the daemon rather than doing a full install.
pub fn setup_nix() -> Step<Use> {
    uses_local(
        "Setup Nix",
        xtask_paths::repo_dir!(".github/actions/setup-nix"),
    )
}

/// Enter the repo's Nix dev shell (toolchain, mold, just, the sccache binary,
/// and `RUSTC_WRAPPER=sccache`) without selecting an sccache provider or
/// configuring an external Nix binary cache. Jobs that compile Rust can follow
/// this with [`configure_namespace_sccache`] to use Namespace's official remote
/// cache. Requires [`setup_nix`] first.
pub fn setup_dev_shell() -> Step<Use> {
    uses_local(
        "Setup Nix dev shell",
        xtask_paths::repo_dir!(".github/actions/setup-nix-dev-shell"),
    )
}

/// Configure Cachix and enter the repo's Nix dev shell. This is retained for
/// workflow families that have not yet migrated to Namespace's Nix cache.
pub fn setup_cachix_dev_shell() -> Step<Use> {
    uses_local(
        "Setup Nix dev shell",
        xtask_paths::repo_dir!(".github/actions/setup-cachix"),
    )
    .add_with(("cachix-auth-token", vars::CACHIX_AUTH_TOKEN))
    .add_with(("dev-shell", "true"))
}

/// Mount the Namespace profile's persisted cache volume: `cache: rust` persists
/// the cargo registry/git, and `path:` persists the Nix store. Compiled objects
/// deliberately use Namespace's official remote sccache instead of this volume.
/// `continue-on-error` because the volume is a pure optimization — a failure
/// just means cold Cargo/Nix state, never a wrong build.
pub fn mount_cache_volume() -> Step<Use> {
    Step::new("Mount Namespace cache volume")
        .uses(
            "namespacelabs",
            "nscloud-cache-action",
            "15799a6b54e5765f85b2aac25b3f0df43ed571c0", // v1.4.3
        )
        .add_with(("cache", "rust"))
        .add_with(("path", xtask_paths::runtime_path!("/nix").as_str()))
        .continue_on_error(true)
}

/// [`mount_cache_volume`] plus the checkout's cargo target dir and the init
/// snapshot store. Persisting `target/` is what makes the preview job's
/// zigbuild incremental — cargo's own fingerprints carry across runs, where
/// remote sccache alone leaves build scripts, native (cmake/zig) compiles, and
/// linking cold every time. Persisting the snapshot store gives the bake step
/// a zero-copy fast path; Namespace artifact storage is its durable fallback.
/// The volume is a block-device mount, so multi-GB trees cost nothing to save
/// or restore when it hits.
pub fn mount_cache_volume_with_cargo_target() -> Step<Use> {
    Step::new("Mount Namespace cache volume")
        .uses(
            "namespacelabs",
            "nscloud-cache-action",
            "15799a6b54e5765f85b2aac25b3f0df43ed571c0", // v1.4.3
        )
        .add_with(("cache", "nix"))
        .add_with((
            "path",
            format!(
                "${{{{ github.workspace }}}}/target\n{}\n/home/runner/.cargo/registry\n/home/runner/.cargo/git",
                vars::PREVIEW_SNAPSHOT_VOLUME_DIR,
            ),
        ))
        .continue_on_error(true)
}

/// Configure Namespace's official artifact-backed remote sccache. Call this
/// after [`setup_dev_shell`] or [`setup_reqs_web`], which install sccache and
/// export `RUSTC_WRAPPER=sccache`. The short-lived WebDAV credentials work
/// across runners and cache-volume misses. Fork PRs skip this step and retain
/// the setup action's local fallback so untrusted code never receives the
/// runner-minted Namespace workspace token.
pub fn configure_namespace_sccache(cache_name: &str) -> Step<Run> {
    namespace_sccache_step(cache_name)
        .if_condition(Expression::new(TRUSTED_NAMESPACE_SCCACHE_CONTEXT))
}

/// Configure Namespace's remote sccache in a trusted context when
/// `additional_condition` is also true.
pub fn configure_namespace_sccache_when(cache_name: &str, additional_condition: &str) -> Step<Run> {
    namespace_sccache_step(cache_name).if_condition(Expression::new(format!(
        "({TRUSTED_NAMESPACE_SCCACHE_CONTEXT}) && ({additional_condition})"
    )))
}

fn namespace_sccache_step(cache_name: &str) -> Step<Run> {
    Step::new("Configure Namespace remote sccache").run(format!(
        r#"set -euo pipefail
env_file="$(mktemp "$RUNNER_TEMP/namespace-sccache.XXXXXX")"
trap 'rm -f "$env_file"' EXIT
if nsc cache sccache setup --cache_name {cache_name} > "$env_file"; then
  # Register credential values as masked BEFORE exporting: GitHub only
  # masks `secrets.*`, so without this SCCACHE_WEBDAV_TOKEN — a broad,
  # ~24h Namespace workspace token (registry + cache write) — printed
  # verbatim in every subsequent step's env dump. Masking is selective by
  # key name: masking non-secrets like the endpoint URL or key prefix
  # would redact those strings everywhere in the logs.
  while IFS= read -r line; do
    k="${{line%%=*}}"
    v="${{line#*=}}"
    [ -n "$v" ] && [ "$k" != "$line" ] || continue
    case "$k" in
      *TOKEN*|*SECRET*|*PASSWORD*) echo "::add-mask::$v" ;;
    esac
  done < "$env_file"
  cat "$env_file" >> "$GITHUB_ENV"
  # Force the next compiler invocation to start a server with the new remote
  # backend even if a setup hook happened to launch one already.
  sccache --stop-server >/dev/null 2>&1 || true
else
  echo "::warning::Namespace remote sccache setup failed; using local cache fallback"
fi"#
    ))
}

/// Mount the web-app cache volume using Namespace's native Nix integration.
/// Bun's install cache is mounted as an explicit path because Bun comes from
/// the Nix dev shell and is not available when this step runs. `with_rust`
/// additionally persists cargo registry/git data for the `gen-api`
/// OpenAPI-binary build; compiled objects live in Namespace's remote sccache.
/// `continue-on-error` for the same reason as [`mount_cache_volume`].
pub fn mount_web_cache_volume(with_rust: bool) -> Step<Use> {
    Step::new("Mount Namespace cache volume")
        .uses(
            "namespacelabs",
            "nscloud-cache-action",
            "15799a6b54e5765f85b2aac25b3f0df43ed571c0", // v1.4.3
        )
        .add_with(("cache", "nix"))
        .map(|step| {
            if with_rust {
                step.add_with((
                    "path",
                    format!(
                        "{}\n/home/runner/.cargo/registry\n/home/runner/.cargo/git",
                        vars::BUN_CACHE_VOLUME_DIR,
                    ),
                ))
            } else {
                step.add_with(("path", vars::BUN_CACHE_VOLUME_DIR))
            }
        })
        .continue_on_error(true)
}

/// The web-app composite: Nix dev shell (bun, biome, just) + `bun install`.
/// Jobs that run `gen-api` follow this with [`configure_namespace_sccache`].
/// Requires [`setup_nix`] first.
pub fn setup_reqs_web(name: &str, playwright: bool) -> Step<Use> {
    uses_local(
        name,
        xtask_paths::repo_dir!(".github/actions/setup-reqs-web"),
    )
    .when(playwright, |step| step.add_with(("playwright", "true")))
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

// ---------------------------------------------------------------------------
// Deploy family (deploy_all_services / reusable_deploy_service) shared steps
// ---------------------------------------------------------------------------

/// `actions/checkout` pinned to the v4 SHA the deploy pipelines use. Compose
/// options at the call site (`clean: false` on jobs reusing a mounted /nix
/// volume, `sparse-checkout` for action-only jobs).
pub fn checkout_v4() -> Step<Use> {
    Step::new("Checkout Repo")
        .uses(
            "actions",
            "checkout",
            "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        ) // v4
        .add_with(("persist-credentials", false))
}

/// Wrap a shell fragment in the standard Cachix watch-store lifecycle.
///
/// The watcher is optional and always cleaned up, so Nix builds still succeed
/// when Cachix is unavailable while every deploy-family caller shares the same
/// process and trap semantics.
pub fn with_cachix_watch(inner: &str) -> String {
    indoc::formatdoc! {r#"
        set -euo pipefail
        cachix_pid=
        if command -v cachix >/dev/null 2>&1 && [ -n "${{CACHIX_CACHE_NAME:-}}" ]; then
          cachix watch-store "$CACHIX_CACHE_NAME" >/tmp/cachix-watch-store.log 2>&1 &
          cachix_pid=$!
          trap 'if [ -n "${{cachix_pid:-}}" ]; then kill "$cachix_pid" 2>/dev/null || true; wait "$cachix_pid" 2>/dev/null || true; fi' EXIT
        fi
        {inner}
    "#}
}

/// `nix build` wrapped in `cachix watch-store`, so realised store paths are
/// pushed to Cachix as they build — the consistency backstop when the /nix
/// volume is cold or evicted.
pub fn nix_build_watched(name: &str, targets: &str, done_msg: &str) -> Step<Run> {
    let script = with_cachix_watch(&format!(
        "nix build --print-build-logs {targets}\necho \"{done_msg}\""
    ));
    Step::new(name).run(script).shell("bash")
}

/// Upload a build's handoff tarball to Namespace artifact storage: strongly
/// consistent object storage that rides Namespace's network rather than the
/// GitHub artifacts API. Attempt-scoped path so re-runs never collide with
/// stale uploads; the deploy job logs the same hash on read.
pub fn upload_handoff_artifact(file: &str, service_expr: &str) -> Step<Run> {
    Step::new("Upload handoff artifact")
        .run(format!("nsc artifact upload {file} \"$DEST\" --expires_in=24h"))
        .shell("bash")
        .add_env(Env::new(
            "DEST",
            format!("handoff/${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}/{service_expr}/{file}"),
        ))
}

/// Mount Pulumi's provider-plugin dir on a Namespace cache volume. Plugins are
/// version-pinned by infra/ and identical across services; a cold volume just
/// re-downloads (~45s). Requires the job to pin `PULUMI_HOME: /pulumi`.
pub fn cache_pulumi_plugins() -> Step<Use> {
    Step::new("Cache Pulumi plugins")
        .uses(
            "namespacelabs",
            "nscloud-cache-action",
            "15799a6b54e5765f85b2aac25b3f0df43ed571c0", // v1.4.3
        )
        .add_with(("path", "/pulumi/plugins"))
        .continue_on_error(true)
}

/// Make PULUMI_HOME (/pulumi) and its mounted plugins subdir writable so
/// pulumi can write credentials + plugins as the runner (no-op when already
/// root). `mkdir -p` first: the plugin cache mount is continue-on-error, so on
/// a mount failure /pulumi may not exist yet — create it so the cold-cache
/// fallback works instead of the chown hard-failing the deploy.
pub fn ensure_pulumi_home_writable() -> Step<Run> {
    Step::new("Ensure Pulumi home is writable")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            sudo mkdir -p /pulumi
            if [ "$(id -u)" -ne 0 ]; then sudo chown -R "$(id -u):$(id -g)" /pulumi; fi
        "#})
        .shell("bash")
}

// ---------------------------------------------------------------------------
// Desktop (AppImage / DMG) shared steps
// ---------------------------------------------------------------------------

/// `actions/checkout` with a dynamic ref (for tag-triggered builds). Uses the
/// same pinned SHA as [`checkout`].
pub fn checkout_ref(ref_expr: &str) -> Step<Use> {
    Step::new("Checkout Repo")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .add_with(("ref", ref_expr))
        .add_with(("persist-credentials", false))
}

/// Mount only the `/nix` store cache volume (no cargo/sccache). Used by the
/// desktop builds that delegate entirely to Nix.
pub fn mount_nix_cache_volume() -> Step<Use> {
    Step::new("Mount /nix cache volume")
        .uses(
            "namespacelabs",
            "nscloud-cache-action",
            "15799a6b54e5765f85b2aac25b3f0df43ed571c0", // v1.4.3
        )
        .add_with(("cache", "nix"))
        .continue_on_error(true)
}

/// Configure Cachix (without entering a dev shell).
pub fn setup_cachix() -> Step<Use> {
    uses_local(
        "Configure Cachix fallback",
        xtask_paths::repo_dir!(".github/actions/setup-cachix"),
    )
    .add_with(("cachix-auth-token", vars::CACHIX_AUTH_TOKEN))
}

/// Derive a safe tag name from the git ref for use in artifact names.
pub fn derive_artifact_metadata(raw_ref_expr: &str) -> Step<Run> {
    Step::new("Derive artifact metadata")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            tag="${RAW_REF#refs/tags/}"
            if [ -z "$tag" ]; then
              tag="${GITHUB_REF_NAME:-untagged}"
            fi
            safe_tag=$(printf '%s' "$tag" | sed 's#[/\\:*?"<>|]#-#g' | tr -d '\r\n')
            echo "tag=$tag" >> "$GITHUB_OUTPUT"
            echo "safe_tag=$safe_tag" >> "$GITHUB_OUTPUT"
        "#})
        .id("metadata")
        .shell("bash")
        .add_env(("RAW_REF", raw_ref_expr))
}

/// Upload build artifacts within the workflow run for a later publish job.
pub fn upload_artifact(name: &str, path: RuntimePath<'_>) -> Step<Use> {
    Step::new(format!("Upload {name} artifact"))
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .add_with(("name", name))
        .add_with(("path", path.as_str()))
        .add_with(("if-no-files-found", "error"))
        .add_with(("retention-days", 30))
}

/// Download all build artifacts into one directory for release publishing.
pub fn download_artifacts(path: RuntimePath<'_>) -> Step<Use> {
    Step::new("Download Build Artifacts")
        .uses(
            "actions",
            "download-artifact",
            "634f93cb2916e3fdff6788551b99b062d0335ce0",
        ) // v5
        .add_with(("path", path.as_str()))
        .add_with(("merge-multiple", true))
}

/// Attach build artifacts to the GitHub release for the resolved release tag.
pub fn upload_release_artifacts(path: RuntimePath<'_>) -> Step<Use> {
    Step::new("Upload Release Artifacts")
        .uses(
            "softprops",
            "action-gh-release",
            "3bb12739c298aeb8a4eeaf626c5b8d85266b0e65",
        ) // v2
        .if_condition(Expression::new(
            "startsWith(steps.metadata.outputs.tag, 'v')",
        ))
        .add_with(("tag_name", "${{ steps.metadata.outputs.tag }}"))
        .add_with(("files", path.as_str()))
        .add_with(("fail_on_unmatched_files", true))
}

/// Teardown Nix (always runs).
pub fn teardown_nix() -> Step<Use> {
    uses_local(
        "Teardown Nix",
        xtask_paths::repo_dir!(".github/actions/teardown-nix"),
    )
    .if_condition(Expression::new("always()"))
}
