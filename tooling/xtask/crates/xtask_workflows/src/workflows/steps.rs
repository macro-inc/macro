//! Reusable workflow building blocks: a small fluent-builder trait plus typed
//! helpers that return `Step`s and `Job`s, composed by the workflow files.
//!
//! Third-party actions come from the typed steps in [`super::actions`],
//! generated from their pins in `actions.lock`.

use gh_workflow::expr::typed::{
    Bool, Expr, Flag, JobHandle, JobOutput, Secret, StepHandle, StepOutput, Str, Var, always,
    github, input,
};
use gh_workflow::{Env, Job, Run, Step, Use};
use xtask_paths::RuntimePath;

use crate::workflows::actions::{
    ActionsCheckout, ActionsDownloadArtifact, ActionsUploadArtifact, GoogleGithubActionsAuth,
    LocalCheckMacroDbMigrations, LocalSetupNix, LocalSetupNixDevShell, LocalSetupReqsWeb,
    LocalSetupRust, LocalTeardownNix, NamespacelabsNscloudCacheAction,
    NamespacelabsNscloudSetupBuildxAction, OvenShSetupBun, SoftpropsActionGhRelease,
};
use crate::workflows::{runners, vars};

#[cfg(test)]
mod test;

/// Namespace's sccache setup mints a short-lived workspace credential. GitHub
/// withholds repository secrets from fork PRs, but this runner-minted token is
/// not a `secrets.*` value, so enforce the equivalent trust boundary here.
pub(crate) fn trusted_namespace_sccache_context() -> Expr<Bool> {
    let not_a_pull_request = github()
        .event_name()
        .ne("pull_request")
        .and(github().event_name().ne("pull_request_target"));
    let same_repository = github()
        .event::<Str>("pull_request.head.repo.full_name")
        .eq(github().repository());
    not_a_pull_request.or(same_repository)
}

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
impl FluentBuilder for ActionsCheckout {}
impl FluentBuilder for GoogleGithubActionsAuth {}
impl FluentBuilder for LocalSetupReqsWeb {}

/// Namespace remote BuildKit, pinned. Multi-arch `docker buildx --push` goes
/// through it so nix-in-Docker work does not land on a Small runner's local
/// daemon.
pub fn setup_namespace_buildx() -> Step<Use> {
    NamespacelabsNscloudSetupBuildxAction::new("Set up Namespace Docker builder").step()
}

/// Has git give up on a checkout's fetch once it moves under 10 kB/s for a
/// minute, so `actions/checkout` retries it (three attempts) instead of waiting
/// for the job timeout. Fetches that usually take seconds have sat for 5 to 13
/// minutes. GitHub sends nothing while it builds the pack; whole shallow and
/// blobless full-history fetches take about 6 to 12 s, so a minute leaves room.
/// The generated `ActionsCheckout` passes every checkout step through it
/// (`STEP_FINISHERS` in `src/actions.rs`).
pub fn abort_stalled_fetch(step: Step<Use>) -> Step<Use> {
    step.add_env(("GIT_HTTP_LOW_SPEED_LIMIT", "10000"))
        .add_env(("GIT_HTTP_LOW_SPEED_TIME", "60"))
}

/// `actions/checkout`, pinned. `full_history` fetches the full history, which
/// the path-filter diff in `path-check` needs. `persist_credentials` controls
/// whether checkout leaves the token in git config for later steps.
pub fn checkout(full_history: bool, persist_credentials: bool) -> Step<Use> {
    checkout_action(full_history, persist_credentials).step()
}

/// [`checkout`], before it becomes a step, for callers that set more inputs.
pub fn checkout_action(full_history: bool, persist_credentials: bool) -> ActionsCheckout {
    ActionsCheckout::new("Checkout")
        .clean(false)
        .when(full_history, |checkout| checkout.fetch_depth(0))
        .when(!persist_credentials, |checkout| {
            checkout.persist_credentials(false)
        })
}

/// `oven-sh/setup-bun` — installs the Bun version the action picks.
pub fn setup_bun() -> Step<Use> {
    setup_bun_action().step()
}

/// [`setup_bun`] before it becomes a step, for call sites that pin a version.
pub fn setup_bun_action() -> OvenShSetupBun {
    OvenShSetupBun::new("Setup Bun")
}

/// The Bun the SDK package builds, checks and publishes with.
pub const SDK_BUN_VERSION: &str = "1.3.5";

/// `oven-sh/setup-bun` with an exact Bun version, for the native
/// release workflows that run the `apps/web/scripts` release helpers.
pub fn setup_bun_pinned() -> Step<Use> {
    OvenShSetupBun::new("Setup Bun")
        .bun_version("1.3.13")
        .step()
}

/// The outputs of [`google_play_auth`].
pub(crate) struct GooglePlayAuthOutputs {
    /// An `androidpublisher` access token.
    pub access_token: StepOutput<Str>,
    /// The credentials file, when asked for one.
    pub credentials_file_path: StepOutput<Str>,
}

/// The step [`google_play_auth`] adds.
pub(crate) const GOOGLE_PLAY_AUTH: StepHandle<GooglePlayAuthOutputs> = StepHandle::new(
    "auth",
    GooglePlayAuthOutputs {
        access_token: StepOutput::new("auth", "access_token"),
        credentials_file_path: StepOutput::new("auth", "credentials_file_path"),
    },
);

/// Keyless Google Play access (Workload Identity Federation through the
/// repository variables `GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER` /
/// `GOOGLE_PLAY_SERVICE_ACCOUNT`), as step `auth`: an `androidpublisher`
/// access token, plus a credentials file for actions that want one. The job
/// needs `id-token: write`. Google's provider admits only workflows that run
/// `main`'s copy (see "Keyless publishing credentials" in
/// docs/development/android.md), so never use this in a `pull_request` job:
/// it would run the PR's code with the publishing identity, and the provider
/// rejects it anyway.
pub fn google_play_auth(credentials_file: bool) -> Step<Use> {
    GoogleGithubActionsAuth::new("Authenticate to Google Play")
        .workload_identity_provider(vars::GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER)
        .service_account(vars::GOOGLE_PLAY_SERVICE_ACCOUNT)
        .token_format("access_token")
        .access_token_scopes("https://www.googleapis.com/auth/androidpublisher")
        .when(!credentials_file, |auth| {
            auth.create_credentials_file(false)
        })
        .export_environment_variables(false)
        .step()
        .id(GOOGLE_PLAY_AUTH.id())
}

/// Install the Rust toolchain only (no sccache, no cache) — for the lightweight
/// `path-check` and workflow-drift jobs.
pub fn setup_rust_light() -> Step<Use> {
    LocalSetupRust::new("Setup Rust")
        .sccache("false")
        .rust_cache("false")
        .step()
}

/// A `bash` step whose output the job's closing "Comment on the PR" step
/// quotes when the job fails. The step records its name in
/// `$RUNNER_TEMP/last-step.name` and tees its stdout and stderr into
/// `$RUNNER_TEMP/last-step.log`, both truncated at the step's start, so the
/// files describe the failed step when the comment step runs (it checks the
/// name against the API's failed step first: an unlogged step may have
/// failed since). Only for steps whose output is messages — the comment is
/// not secret-masked the way the log is, so a step that handles credentials
/// or runs a build stays an ordinary step.
pub fn logged_run(name: &str, script: impl AsRef<str>) -> Step<Run> {
    Step::new(name)
        .run(format!(
            "printf '%s\\n' \"$LOGGED_STEP\" > \"$RUNNER_TEMP/last-step.name\"\n\
             exec > >(tee \"$RUNNER_TEMP/last-step.log\") 2>&1\n\
             {}",
            script.as_ref()
        ))
        .shell("bash")
        .add_env(("LOGGED_STEP", name))
}

/// The Xcode every iOS build compiles with: the layout plugin uses iOS 27.1
/// SDK APIs. Raising it needs a [`runners::Runner::MacOsTahoeArm`] image that
/// installs the new version (Namespace's image feed lists them).
pub const IOS_XCODE_VERSION: &str = "27.1";

/// Select [`IOS_XCODE_VERSION`] with `xcode-select`, failing with the
/// installed list when the runner lacks it. Runs before Nix is installed, so a
/// wrong image fails in seconds.
pub fn select_ios_xcode() -> Step<Run> {
    logged_run(
        &format!("Select Xcode {IOS_XCODE_VERSION}"),
        include_str!("scripts/select_xcode.sh"),
    )
    .add_env(("XCODE_VERSION", IOS_XCODE_VERSION))
}

/// Install Nix on a macOS runner. The Linux [`setup_nix`] action doesn't apply
/// there, so Apple jobs (DMG signing, the iOS simulator preview) install it
/// with the same script instead.
pub fn install_nix_macos() -> Step<Run> {
    Step::new("Install Nix")
        .run(include_str!("scripts/install_nix_macos.sh"))
        .shell("bash")
}

/// Install + initialise Nix on the runner. Namespace profiles don't ship Nix,
/// so this must run before [`setup_dev_shell`] (which shells out to `nix`). The
/// `/nix` cache volume mounted by [`mount_cache_volume`] keeps the store warm,
/// so it re-inits the daemon rather than doing a full install.
pub fn setup_nix() -> Step<Use> {
    LocalSetupNix::new("Setup Nix").step()
}

/// [`setup_nix`] with the private S3 binary cache configured as a substituter,
/// so a /nix cache-volume miss degrades to a download instead of a rebuild.
/// Only for trusted jobs with access to the AWS secrets (never PR-triggered
/// jobs). No-ops back to plain [`setup_nix`] behavior while the
/// `NIX_CACHE_*` repo variables are unset.
pub fn setup_nix_with_cache() -> Step<Use> {
    LocalSetupNix::new("Setup Nix")
        .nix_cache_url(vars::NIX_CACHE_URL)
        .nix_cache_public_key(vars::NIX_CACHE_PUBLIC_KEY)
        .aws_access_key_id(vars::AWS_ACCESS_KEY)
        .aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .step()
}

/// [`setup_nix`] restoring `/nix` from Namespace's HTTP cache when the volume is
/// empty. PR jobs write that copy, so this is only for PR check jobs: never a job
/// that deploys or holds deploy secrets.
pub fn setup_nix_with_seed() -> Step<Use> {
    LocalSetupNix::new("Setup Nix")
        .seed_cache(vars::CI_SCCACHE_NAME)
        .step()
}

/// Push built store paths to the private S3 binary cache, signing on upload —
/// the `cachix watch-store` role. `targets` lands in the step's `TARGETS` env
/// (space-separated flake refs or store paths; GH expressions fine) and is
/// word-split on purpose. Skips silently while the cache vars/secret are
/// unset, and never fails the job: the cache is an optimization, and the paths
/// were already handed off via Namespace artifacts.
pub fn push_nix_cache(targets: &str) -> Step<Run> {
    Step::new("Push to nix cache")
        .run(indoc::indoc! {r#"
            set -uo pipefail
            if [[ -z "${NIX_CACHE_URL:-}" || -z "${NIX_CACHE_SIGNING_KEY:-}" ]]; then
              echo "nix cache not configured; skipping push"
              exit 0
            fi
            key="$RUNNER_TEMP/nix-cache-signing-key"
            printf '%s\n' "$NIX_CACHE_SIGNING_KEY" > "$key"
            sep='?'; [[ "$NIX_CACHE_URL" == *\?* ]] && sep='&'
            # shellcheck disable=SC2086 # TARGETS is a list on purpose
            nix copy --to "${NIX_CACHE_URL}${sep}secret-key=${key}" $TARGETS \
              || echo "::warning::nix cache push failed (non-fatal)"
            rm -f "$key"
        "#})
        .shell("bash")
        .add_env(Env::new("TARGETS", targets))
        .add_env(Env::new("NIX_CACHE_URL", vars::NIX_CACHE_URL))
        .add_env(Env::new(
            "NIX_CACHE_SIGNING_KEY",
            vars::NIX_CACHE_SIGNING_KEY,
        ))
        .add_env(Env::new("AWS_ACCESS_KEY_ID", vars::AWS_ACCESS_KEY))
        .add_env(Env::new(
            "AWS_SECRET_ACCESS_KEY",
            vars::AWS_SECRET_ACCESS_KEY,
        ))
}

/// Enter the repo's Nix dev shell (toolchain, mold, just, the sccache binary,
/// and `RUSTC_WRAPPER=sccache`) without selecting an sccache provider or
/// configuring an external Nix binary cache. Jobs that compile Rust can follow
/// this with [`configure_namespace_sccache`] to use Namespace's official remote
/// cache. Requires [`setup_nix`] first. The composite action defaults to the
/// `default` flake shell when no `shell` input is passed.
pub fn setup_dev_shell() -> Step<Use> {
    LocalSetupNixDevShell::new("Setup Nix dev shell").step()
}

/// [`setup_dev_shell`] for a named `devShells.<name>` flake output.
pub fn setup_dev_shell_named(name: &str) -> Step<Use> {
    LocalSetupNixDevShell::new("Setup Nix dev shell")
        .shell(name)
        .step()
}

/// Mount the Namespace profile's persisted cache volume: cargo's registry, git
/// checkouts and `target/`, and the Nix store. Listing the paths mounts in under a
/// second, where the action's `cache: rust` mode took about 12 s to find the same
/// ones. Compiled objects deliberately use Namespace's official remote sccache
/// instead of this volume.
/// `continue-on-error` because the volume is a pure optimization — a failure
/// just means cold Cargo/Nix state, never a wrong build.
pub fn mount_cache_volume() -> Step<Use> {
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        cache.path(
            "/nix\n./target\n/home/runner/.cargo/registry\n/home/runner/.cargo/git\n/home/runner/.cargo/.global-cache",
        )
    })
}

/// Mount the desktop app check's cache volume: the Nix store with the Tauri
/// libraries, and cargo's registry and git checkouts (the Tauri fork is a git
/// dependency). Compiled objects use the desktop remote sccache, so the
/// volume keeps no `target` directory to grow with every lockfile change.
pub fn mount_desktop_cache_volume() -> Step<Use> {
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        cache.path("/nix\n/home/runner/.cargo/registry\n/home/runner/.cargo/git")
    })
}

/// Mount a scratch directory for building the nextest filter, plus cargo's registry
/// and git checkouts. `cargo metadata` fetches every crate in the lockfile, which took
/// most of the filter's time when `path-check` had no registry to start from.
pub fn mount_nextest_filter_cache(filter_cache_dir: RuntimePath<'_>) -> Step<Use> {
    let paths = format!(
        "{}\n{}\n{}",
        filter_cache_dir.as_str(),
        xtask_paths::runtime_path!("/home/runner/.cargo/registry").as_str(),
        xtask_paths::runtime_path!("/home/runner/.cargo/git").as_str(),
    );

    nscloud_cache_action("Mount nextest-filter and cargo registry cache", |cache| {
        cache.path(paths)
    })
}

/// The pinned `nscloud-cache-action`, configured by `mounts`, shared by every
/// mount helper. `continue-on-error` because a cache volume is always a pure
/// optimization — a failure just means cold state, never a wrong build.
fn nscloud_cache_action(
    name: &str,
    mounts: impl FnOnce(NamespacelabsNscloudCacheAction) -> NamespacelabsNscloudCacheAction,
) -> Step<Use> {
    mounts(NamespacelabsNscloudCacheAction::new(name))
        .step()
        .continue_on_error(true)
}

/// [`mount_cache_volume`] for the wasm worker build. `target/` is listed
/// explicitly so cargo fingerprints survive across runs. The last two paths
/// are what wrangler's `[build]` line otherwise redoes every run: the pinned
/// `worker-build` binary and wasm-pack's downloaded `wasm-opt`.
pub fn mount_wasm_cache_volume() -> Step<Use> {
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        cache.cache("rust").path(format!(
            "{}/target\n{}\n{}",
            github().workspace(),
            xtask_paths::runtime_path!("/home/runner/.cargo/bin").as_str(),
            xtask_paths::runtime_path!("/home/runner/.cache/.wasm-pack").as_str(),
        ))
    })
}

/// Configure Namespace's official artifact-backed remote sccache. Call this
/// after [`setup_dev_shell`] or [`setup_reqs_web`], which install sccache and
/// export `RUSTC_WRAPPER=sccache`. The short-lived WebDAV credentials work
/// across runners and cache-volume misses. Fork PRs skip this step and retain
/// the setup action's local fallback so untrusted code never receives the
/// runner-minted Namespace workspace token.
pub fn configure_namespace_sccache(cache_name: &str) -> Step<Run> {
    namespace_sccache_step(cache_name).if_condition(trusted_namespace_sccache_context())
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
  # The server checks the WebDAV backend before it reports ready, and the
  # client's default 10s wait can run out. This limit has no env var.
  sccache_conf="$RUNNER_TEMP/sccache.toml"
  echo 'server_startup_timeout_ms = 60000' > "$sccache_conf"
  echo "SCCACHE_CONF=$sccache_conf" >> "$GITHUB_ENV"
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
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        let cache = cache.cache("nix");
        if with_rust {
            cache.path(format!(
                "{}\n/home/runner/.cargo/registry\n/home/runner/.cargo/git",
                vars::BUN_CACHE_VOLUME_DIR,
            ))
        } else {
            cache.path(vars::BUN_CACHE_VOLUME_DIR)
        }
    })
}

/// [`mount_web_cache_volume`] for PR check jobs, which also keep the
/// workspace's [`vars::node_modules_volume_dir`] on the volume, so their
/// `bun install` finds the tree in place. Never for deploy jobs.
pub fn mount_web_check_cache_volume(with_rust: bool) -> Step<Use> {
    let mut paths = vec![
        vars::BUN_CACHE_VOLUME_DIR.to_string(),
        vars::node_modules_volume_dir(),
    ];
    if with_rust {
        paths.extend([
            "/home/runner/.cargo/registry".to_string(),
            "/home/runner/.cargo/git".to_string(),
        ]);
    }
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        cache.cache("nix").path(paths.join("\n"))
    })
}

/// [`mount_web_check_cache_volume`] with Rust, plus cargo's `target` directory.
/// Only for a job on its own cache tag ([`vars::WEB_CODEGEN_CACHE_TAG`]), followed
/// by [`reuse_cargo_target`] before anything builds.
pub fn mount_web_codegen_cache_volume() -> Step<Use> {
    let paths = [
        vars::BUN_CACHE_VOLUME_DIR.to_string(),
        vars::node_modules_volume_dir(),
        "/home/runner/.cargo/registry".to_string(),
        "/home/runner/.cargo/git".to_string(),
        vars::cargo_target_volume_dir(),
    ];
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        cache.cache("nix").path(paths.join("\n"))
    })
}

/// Date the checkout's files by when their contents first appeared, so cargo
/// rebuilds only the workspace crates whose sources differ from the builds the
/// kept `target` directory holds (`scripts/cargo_target_reuse.ts`).
pub fn reuse_cargo_target() -> Step<Run> {
    Step::new("Reuse the kept cargo target")
        .run(node_script(include_str!("scripts/cargo_target_reuse.ts")))
}

/// The last step of every job that runs [`reuse_cargo_target`]: marks every unit
/// the job built as described by the record, so a job that later builds into
/// the same `target` without dating its checkout is caught.
pub fn seal_cargo_target() -> Step<Run> {
    Step::new("Seal the kept cargo target").run(node_script_calling(
        include_str!("scripts/cargo_target_reuse.ts"),
        "seal",
    ))
}

/// [`mount_web_check_cache_volume`] plus Vitest's module cache, so the web `Test`
/// job reuses transforms from earlier runs instead of redoing them all.
pub fn mount_web_test_cache_volume() -> Step<Use> {
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        cache.cache("nix").path(format!(
            "{}\n{}\n/home/runner/.cargo/registry\n/home/runner/.cargo/git\n{}\n{}\n{}",
            vars::BUN_CACHE_VOLUME_DIR,
            vars::node_modules_volume_dir(),
            xtask_paths::runtime_path!("/home/runner/.cache/.wasm-pack").as_str(),
            vars::VITEST_MODULE_CACHE_VOLUME_DIR,
            vars::WASM_PKG_CACHE_DIR,
        ))
    })
}

/// [`mount_web_cache_volume`] for the PR jobs that compile the browser wasm
/// packages (`just build-*`). `node_modules` adds [`vars::node_modules_volume_dir`]
/// for a job that holds no deploy credentials. Cargo registry/git feed wasm-pack; `.wasm-pack`
/// is the downloaded `wasm-opt` the same way [`mount_wasm_cache_volume`] keeps
/// the worker build warm; [`vars::WASM_PKG_CACHE_DIR`] holds the unchanged
/// packages it reuses. Deploy builds keep theirs in an Actions cache instead
/// (`build_web_app`) and mount none of these, since PR jobs write this volume.
pub fn mount_web_build_check_cache_volume(node_modules: bool) -> Step<Use> {
    let mut paths = vec![vars::BUN_CACHE_VOLUME_DIR.to_string()];
    if node_modules {
        paths.push(vars::node_modules_volume_dir());
    }
    paths.extend(
        [
            "/home/runner/.cargo/registry",
            "/home/runner/.cargo/git",
            xtask_paths::runtime_path!("/home/runner/.cache/.wasm-pack").as_str(),
            vars::WASM_PKG_CACHE_DIR,
        ]
        .map(str::to_string),
    );
    nscloud_cache_action("Mount Namespace cache volume", |cache| {
        cache.cache("nix").path(paths.join("\n"))
    })
}

/// The web-app composite: Nix dev shell (bun, biome, just) + `bun install`.
/// Jobs that run `gen-api` follow this with [`configure_namespace_sccache`].
/// Requires [`setup_nix`] first.
pub fn setup_reqs_web(name: &str, playwright: bool) -> Step<Use> {
    LocalSetupReqsWeb::new(name)
        .when(playwright, |action| action.playwright("true"))
        .step()
}

/// Build the code-mode assets (`crates/code_mode_assets`) in Nix, or restore them
/// from Namespace's remote cache, and point later cargo steps at them, so Rust jobs
/// need no bun install. Any job that compiles that crate or a dependent (DSS, the
/// agent harness) needs this. Goes after [`configure_namespace_sccache`], whose
/// credentials it reuses.
pub fn code_mode_assets() -> Step<Run> {
    Step::new("Build code-mode assets").run(include_str!("scripts/code_mode_assets.sh"))
}

/// Where [`start_opensearch`]'s cluster answers.
pub const SEARCH_OPENSEARCH_URL: &str = "http://127.0.0.1:9200";

/// OpenSearch at [`SEARCH_OPENSEARCH_URL`]. Not a service container: the image
/// is built from the local stack's Dockerfile, which adds a plugin. Start it
/// before the build, so it is up when [`create_search_indices`] runs.
pub fn start_opensearch() -> Step<Run> {
    Step::new("start opensearch").run(include_str!("scripts/start_opensearch.sh"))
}

/// Wait for [`start_opensearch`]'s cluster and create the search indices and
/// aliases in it with `create_indices.ts`. Needs the dev shell's bun.
pub fn create_search_indices() -> Step<Run> {
    Step::new("create the search indices")
        .run(include_str!("scripts/create_search_indices.sh"))
        .add_env(("SEARCH_OPENSEARCH_URL", SEARCH_OPENSEARCH_URL))
}

/// Start the server before parallel compiler invocations can race to launch it.
/// Keep this in a separate step after remote configuration so `GITHUB_ENV`
/// has supplied the selected backend's credentials to the process.
pub fn start_sccache_server() -> Step<Run> {
    Step::new("Start sccache server").run("sccache --start-server")
}

/// Run embedded TypeScript on the hosted image's Node, which strips types
/// itself, so the step needs no checkout, build or dependency. The script
/// exports `main`.
pub fn node_script(source: &str) -> String {
    node_script_calling(source, "main")
}

/// [`node_script`], calling another exported function.
pub fn node_script_calling(source: &str, function: &str) -> String {
    format!(
        "node --disable-warning=ExperimentalWarning --input-type=module-typescript <<'NODE_SCRIPT'\n{source}\nawait {function}();\nNODE_SCRIPT\n"
    )
}

/// Post to the Macro Alerts channel through its webhook
/// ([`vars::MACRO_BUILD_ALERT_WEBHOOK_URL`], with
/// [`vars::MACRO_BUILD_ALERT_BOT_TOKEN`]). `set_message` is bash that sets
/// `message`, which the channel renders as markdown. Needs `jq` and `curl`,
/// which [`runners::Runner::Small`] has.
pub fn post_to_macro_alerts(name: &str, set_message: &str) -> Step<Run> {
    post_to_macro_channel(
        name,
        set_message,
        "Macro Alerts",
        vars::MACRO_BUILD_ALERT_WEBHOOK_URL,
        vars::MACRO_BUILD_ALERT_BOT_TOKEN,
    )
}

/// [`post_to_macro_alerts`], to the Macro channel `channel` whose webhook is
/// `webhook` (a repo variable), posting with the bot token `token`.
pub fn post_to_macro_channel(
    name: &str,
    set_message: &str,
    channel: &str,
    webhook: Var,
    token: Secret,
) -> Step<Run> {
    let post = indoc::indoc! {r#"
        if [[ -z "$MACRO_WEBHOOK_URL" || -z "$MACRO_BOT_TOKEN" ]]; then
          echo 'Configure the CHANNEL webhook URL and bot token' >&2
          exit 1
        fi
        jq -n --arg content "$message" '{content: $content}' |
          curl --fail-with-body --silent --show-error --retry 3 \
            --header 'Content-Type: application/json' \
            --header "x-macro-channel-bot-token: $MACRO_BOT_TOKEN" \
            --data-binary @- "$MACRO_WEBHOOK_URL"
    "#}
    .replace("CHANNEL", channel);
    Step::new(name)
        .run(format!(
            "set -euo pipefail\n{}\n{post}",
            set_message.trim_end()
        ))
        .shell("bash")
        .add_env(("MACRO_WEBHOOK_URL", webhook))
        .add_env(("MACRO_BOT_TOKEN", token))
}

/// `sccache --show-stats` at the end of a job (never fails the job).
pub fn show_sccache_stats() -> Step<Run> {
    Step::new("show sccache stats")
        .run("sccache --show-stats || true")
        .if_condition(always())
}

/// Base for jobs gated behind `path-check`: depends on it and runs only where
/// the path filter matched. Shared by `check` and `test`.
pub fn gated_job(should_run: &JobOutput<Flag>) -> Job {
    Job::default()
        .needs(vec![should_run.job().to_string()])
        .cond(should_run.read().is_set())
}

// ---------------------------------------------------------------------------
// Deploy family (deploy_all_services / reusable_deploy_service) shared steps
// ---------------------------------------------------------------------------

/// `actions/checkout` for the deploy pipelines, without credentials. Compose
/// options at the call site (`clean: false` on jobs reusing a mounted /nix
/// volume, `sparse-checkout` for action-only jobs).
pub fn checkout_v4() -> Step<Use> {
    checkout_v4_action().step()
}

/// [`checkout_v4`] before it becomes a step, for call sites that add inputs.
pub fn checkout_v4_action() -> ActionsCheckout {
    ActionsCheckout::new("Checkout Repo").persist_credentials(false)
}

/// A deploy that ships code built from this commit is blocked until every
/// migration in the commit is applied to the environment it deploys to:
/// single-service deploys apply none, and code running against a schema it is
/// ahead of fails at runtime. `ships_code` is the `setup` job's expression for
/// whether the deploy carries binaries or Lambdas; the deploy job must list
/// this job in its `needs`.
pub fn check_macro_db_migrations_job<SetupOutputs>(
    name: &str,
    setup: &JobHandle<SetupOutputs>,
    ships_code: Expr<Bool>,
) -> Job {
    Job::default()
        .name(name)
        .needs(vec![setup.to_string()])
        .cond(ships_code)
        .runs_on(runners::DB_MIGRATOR)
        .add_step(checkout_v4_action().sparse_checkout(".github/").step())
        .add_step(
            LocalCheckMacroDbMigrations::new("Check migrations", input::<Str>("environment"))
                .step(),
        )
}

/// Build Nix targets using Namespace's mounted `/nix` cache volume.
pub fn nix_build(name: &str, targets: &str, done_msg: &str) -> Step<Run> {
    Step::new(name)
        .run(format!(
            "set -euo pipefail\nnix build --print-build-logs {targets}\necho \"{done_msg}\""
        ))
        .shell("bash")
}

/// Upload a build's handoff tarball to Namespace artifact storage: strongly
/// consistent object storage that rides Namespace's network rather than the
/// GitHub artifacts API. Attempt-scoped path so re-runs never collide with
/// stale uploads; the deploy job logs the same hash on read.
pub fn upload_handoff_artifact(file: &str, service: Expr<Str>) -> Step<Run> {
    Step::new("Upload handoff artifact")
        .run(format!(
            "bun .github/scripts/upload-handoff-artifact.ts {file} \"$DEST\""
        ))
        .timeout_minutes(20u32)
        .shell("bash")
        .add_env(Env::new(
            "DEST",
            format!(
                "handoff/{}-{}/{service}/{file}",
                github().run_id(),
                github().run_attempt()
            ),
        ))
}

/// Mount Pulumi's provider-plugin dir on a Namespace cache volume. Plugins are
/// version-pinned by infra/ and identical across services; a cold volume just
/// re-downloads (~45s). Requires the job to pin `PULUMI_HOME: /pulumi`.
pub fn cache_pulumi_plugins() -> Step<Use> {
    nscloud_cache_action("Cache Pulumi plugins", |cache| {
        cache.path("/pulumi/plugins")
    })
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

/// `actions/checkout` with a dynamic ref (for tag-triggered builds).
pub fn checkout_ref(git_ref: Expr<Str>) -> Step<Use> {
    ActionsCheckout::new("Checkout Repo")
        .r#ref(git_ref)
        .persist_credentials(false)
        .step()
}

/// Mount only the `/nix` store cache volume (no cargo/sccache). Used by the
/// desktop builds that delegate entirely to Nix.
pub fn mount_nix_cache_volume() -> Step<Use> {
    nscloud_cache_action("Mount /nix cache volume", |cache| cache.cache("nix"))
}

/// macOS cache mounts are symlinks, which Nix does not support for `/nix`.
/// Persist a file binary cache instead, leaving the live store to the installer.
pub fn mount_macos_nix_cache_volume() -> Step<Use> {
    nscloud_cache_action("Mount macOS Nix binary cache", |cache| {
        cache.path("~/.cache/macro-desktop-nix")
    })
}

/// The outputs of [`derive_artifact_metadata`].
pub(crate) struct ArtifactMetadataOutputs {
    /// The release tag taken from the ref.
    pub tag: StepOutput<Str>,
    /// `tag` with the characters artifact names can't hold replaced.
    pub safe_tag: StepOutput<Str>,
}

/// The step [`derive_artifact_metadata`] adds.
pub(crate) const ARTIFACT_METADATA: StepHandle<ArtifactMetadataOutputs> = StepHandle::new(
    "metadata",
    ArtifactMetadataOutputs {
        tag: StepOutput::new("metadata", "tag"),
        safe_tag: StepOutput::new("metadata", "safe_tag"),
    },
);

/// Derive a safe tag name from the git ref for use in artifact names.
pub fn derive_artifact_metadata(raw_ref: Expr<Str>) -> Step<Run> {
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
        .id(ARTIFACT_METADATA.id())
        .shell("bash")
        .add_env(("RAW_REF", raw_ref))
}

/// Upload build artifacts within the workflow run for a later publish job.
pub fn upload_artifact(name: &str, path: RuntimePath<'_>) -> Step<Use> {
    upload_artifact_action(name, path).step()
}

/// [`upload_artifact`] before it becomes a step, for call sites that override
/// an input.
pub(crate) fn upload_artifact_action(name: &str, path: RuntimePath<'_>) -> ActionsUploadArtifact {
    ActionsUploadArtifact::new(&format!("Upload {name} artifact"), path.as_str())
        .name(name)
        .if_no_files_found("error")
        .retention_days(30)
}

/// Download the build artifacts (all, or those matching `pattern`) into one
/// directory for release publishing.
pub fn download_artifacts(path: RuntimePath<'_>, pattern: Option<&str>) -> Step<Use> {
    let download = ActionsDownloadArtifact::new("Download Build Artifacts");
    // A pattern keeps artifacts that are not release assets (QA results) out.
    let download = match pattern {
        Some(pattern) => download.pattern(pattern),
        None => download,
    };
    download.path(path.as_str()).merge_multiple(true).step()
}

/// Attach build artifacts to the GitHub release for the resolved release tag.
pub fn upload_release_artifacts(path: RuntimePath<'_>) -> Step<Use> {
    SoftpropsActionGhRelease::new("Upload Release Artifacts")
        .tag_name(ARTIFACT_METADATA.outputs.tag.read())
        .files(path.as_str())
        .fail_on_unmatched_files(true)
        .step()
        .if_condition(ARTIFACT_METADATA.outputs.tag.read().starts_with("v"))
}

/// After a blobless checkout (`filter: blob:none`):
/// - older git marks the repository with `extensions.partialclone`, which
///   Nix's libgit2 refuses to open; `remote.origin.promisor` alone still lets
///   git fetch missing blobs on demand;
/// - `git diff` finds renames by reading the merge base's blobs, and `biome
///   --changed` ignores its exit status, so a failed fetch there would check
///   no files. Without rename detection, `--name-only` lists the same paths
///   and reads no blob.
pub fn prepare_blobless_checkout() -> Step<Run> {
    Step::new("Prepare the blobless checkout").run(
        "if git config extensions.partialclone >/dev/null; then git config --unset extensions.partialclone; fi\ngit config diff.renames false\n",
    )
}

/// Teardown Nix (always runs).
pub fn teardown_nix() -> Step<Use> {
    LocalTeardownNix::new("Teardown Nix")
        .step()
        .if_condition(always())
}
