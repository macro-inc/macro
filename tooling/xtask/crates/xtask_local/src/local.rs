//! xtask-owned local & dev orchestration.
//!
//! `just run_local`, `just run_dev`, and the supporting
//! `doctor`/`validate`/`status`/`stop`/`reset`/`destroy` recipes all delegate here.
//! This module owns: building service binaries natively on the host,
//! the minimal runtime image, the typed service inventory, per-instance
//! isolation, environment layering, generated docker-compose overrides, local
//! infra (FusionAuth via kickstart, Mailpit, LocalStack, Postgres/Redis, DB
//! migrate), the single-origin reverse proxy, the frontend dev server, and the
//! background process that runs all of it when no terminal stays attached.
//!
//! Design invariant: Docker never compiles Rust. Binaries are built on the host
//! and bind-mounted read-only into the runtime image at `/app/out`.

use std::path::PathBuf;

pub mod allocator;
pub mod arch;
pub mod build;
pub mod cf_tunnel;
pub mod cli;
pub mod content_key;
pub mod db;
pub mod docker;
pub mod doctor;
pub mod e2e;
pub mod env_layer;
pub mod frontend;
pub mod fusionauth;
pub mod gen_compose;
pub mod identity;
pub mod instance;
pub mod inventory;
pub mod kafka;
pub mod kickstart;
pub mod local_env;
pub mod localstack;
pub mod mailpit;
pub mod opensearch;
pub mod portmap;
pub mod proxy;
pub mod resources;
pub mod sandbox_image;
pub mod sdk_webhook;
pub mod seed_env;
pub mod snapshot;
pub mod stack;
pub mod stage;
pub mod staleness;
pub mod status;
pub mod summary;
pub mod supervisor;
mod telemetry;
pub mod tls;
pub mod validate;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod test;

/// What flavor of stack we are bringing up. The mode drives which infra runs,
/// which env applies, and which service subset starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Fully local: local Postgres/Redis/FusionAuth/Mailpit/LocalStack + app
    /// services + proxy + frontend. No Pulumi, no real AWS, no SES.
    Local,
    /// Local binaries pointed at shared dev resources. No local infra.
    Dev,
}

/// The per-mode behavior table. Each [`Mode`] resolves to exactly one
/// `ModeSpec`, and the orchestration code reads these fields instead of matching
/// on the enum — so a mode's behavior lives in one place and adding a mode is one
/// new [`Mode::spec`] arm rather than a hunt through ten files.
#[derive(Clone, Copy, Debug)]
pub struct ModeSpec {
    /// Human-facing label (`local` / `dev`).
    pub label: &'static str,
    /// The Doppler `local`-project config pulled as the secret base.
    pub doppler_config: &'static str,
    /// Overlay the code-owned [`local_env::LocalEnv`] on top of Doppler (local
    /// plumbing is authoritative). Off for dev, which runs against Doppler's
    /// dev values.
    pub overlay_local_env: bool,
    /// Resolve the developer's real AWS credentials and strip any local-only
    /// endpoints — dev talks to real AWS/RDS, not LocalStack/Postgres.
    pub uses_remote_aws: bool,
    /// Run the local-only infra: the FusionAuth kickstart, Mailpit, and the
    /// per-instance Postgres/Redis/OpenSearch isolation. Off for dev, which
    /// shares the deployed resources (LocalStack + Redis still run either way).
    pub runs_local_infra: bool,
    /// Migrate the local DB after bring-up. Off for dev — `DATABASE_URL` is the
    /// shared dev RDS and must never be migrated from here.
    pub migrates_db: bool,
    /// Route `/static-file` through LocalStack S3 (vs. the dev-pointed service).
    pub static_files_via_localstack: bool,
    /// Wait for the backend (proxy `/auth/health`) before starting the frontend.
    pub wait_backend_before_frontend: bool,
    /// Show the local infra endpoints (proxy/FusionAuth/Mailpit/…) in the
    /// summary.
    pub show_infra_in_summary: bool,
}

impl Mode {
    /// The behavior table for this mode (see [`ModeSpec`]).
    pub const fn spec(self) -> ModeSpec {
        match self {
            Mode::Local => ModeSpec {
                label: "local",
                doppler_config: "lcl_personal",
                overlay_local_env: true,
                uses_remote_aws: false,
                runs_local_infra: true,
                migrates_db: true,
                static_files_via_localstack: true,
                wait_backend_before_frontend: true,
                show_infra_in_summary: true,
            },
            Mode::Dev => ModeSpec {
                label: "dev",
                doppler_config: "dev_personal",
                overlay_local_env: false,
                uses_remote_aws: true,
                runs_local_infra: false,
                migrates_db: false,
                static_files_via_localstack: false,
                wait_backend_before_frontend: false,
                show_infra_in_summary: false,
            },
        }
    }

    pub fn label(self) -> &'static str {
        self.spec().label
    }

    /// The value of the `ENVIRONMENT` variable services read (`macro_env`).
    /// Always `local`, including dev. In the `dev`/`prod` macro_env environments
    /// the `remote_env_var` layer treats each config var's env value as the NAME
    /// of a Secrets Manager secret to fetch; only `local` reads the env value as
    /// the value itself. The Doppler `dev_personal` config ships real values (a
    /// postgres URL, keys), not secret names, so `run_dev` must run as `local`
    /// and gets its "dev-ness" from those values (dev DB + real AWS), not from
    /// switching macro_env to `dev`.
    pub fn environment_var(self) -> &'static str {
        "local"
    }
}

/// The repository Cargo workspace root. Anchored on the manifest dir rather
/// than the invocation cwd so the orchestrator works from anywhere.
pub fn workspace_root() -> PathBuf {
    xtask_paths::workspace_root()
}

/// The repository root. This is where `docker/`, `infra/`, `apps/`, and the
/// root `justfile` live.
pub fn repo_root() -> PathBuf {
    xtask_paths::repo_root()
}

use std::process::Command;

use anyhow::Result;

use instance::{Instance, Port};
use stage::Stage;

/// Every non-Rust local service whose image is built from this repository.
/// `docker compose up` builds a missing image implicitly, but an Environment
/// Build must materialize all of them so a fresh agent never discovers one at
/// stack-start time.
const LOCAL_BUILD_SERVICE_IMAGES: &[&str] = &[
    "websocket_service",
    "sync_service",
    "lexical_service",
    "ai_editing_worker",
    "analytics_proxy",
    "sdk-webhook-relay",
    "search",
    "headless-chrome",
];

/// Repository-built app containers safe to recreate during `stack update`.
/// OpenSearch is built for cold-stack correctness but remains under the infra
/// lifecycle, which waits for health before Rust services can reconnect.
const LOCAL_RECREATE_SERVICE_IMAGES: &[&str] = &[
    "websocket_service",
    "sync_service",
    "lexical_service",
    "ai_editing_worker",
    "analytics_proxy",
    "sdk-webhook-relay",
];

/// Image-only app services that infra-only bake mode does not otherwise start.
/// Infra images are pulled by `bring_up_infra`; the Rust runtime image is built
/// separately by [`build::ensure_runtime_image`].
const LOCAL_PULL_SERVICE_IMAGES: &[&str] = &["proxy", "mailpit", "static_file_cdn"];

/// How a bring-up treats whatever the instance already has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Start {
    /// Full delete + full create: tear the previous stack and ALL its stateful
    /// volumes down, so no persisted state (a stale FusionAuth DB, an old
    /// migration) can poison the run.
    Fresh,
    /// Keep the volumes and bring everything up over them. Init steps are all
    /// idempotent, so this also applies new migrations and restores what
    /// LocalStack loses on a stop.
    Resume,
}

/// What a bring-up should produce. Every flow runs [`bring_up`]; they differ only
/// in this plan and in what they do once it returns.
pub(crate) struct BringUp {
    /// Vite will be started afterwards, so the proxy forwards the app to it.
    pub vite: bool,
    /// Build a static bundle and serve it from the proxy.
    pub static_bundle: bool,
    /// Open the Cloudflare tunnels that share a fully local stack.
    pub share_app: bool,
    /// Stop after infra and init: no app services, proxy, or frontend.
    pub infra_only: bool,
    pub start: Start,
}

/// What a finished [`bring_up`] leaves for its caller.
pub(crate) struct StackUp {
    pub env: env_layer::ResolvedEnv,
    pub target: arch::Target,
    /// Dropping these closes the tunnels, so they live as long as the stack does.
    pub tunnels: Vec<cf_tunnel::QuickTunnel>,
    pub shared_app_url: Option<String>,
}

/// The one bring-up every flow shares (`run_local` attached and detached, `run_dev`,
/// `stack up`): env, binaries, infra, app services, tunnels, a healthy backend
/// through the proxy, and the recorded state later commands read. Starting Vite is
/// left to the caller, since only some flows do it.
pub(crate) fn bring_up(
    stage: &Stage,
    mode: Mode,
    instance: &mut Instance,
    args: &cli::RunArgs,
    plan: &BringUp,
) -> Result<StackUp> {
    if !stage.is_dry_run() {
        stack::clear_state(instance)?;
    }
    if let Some(job) = stage.job() {
        job.bring_up(mode, plan);
    }

    // Before `prepare` (which resolves env and reads the OTLP port to decide
    // whether to wire `OTEL_EXPORTER_OTLP_ENDPOINT`), so a `--traces` run gets
    // the same auto-wiring as a collector started manually beforehand. A CI bake
    // has no services to trace and no one driving a browser, so it skips both.
    if !plan.infra_only {
        ensure_tracing_backend(stage, args.traces)?;
        if args.with_chrome {
            ensure_headless_chrome(stage);
        }
    }

    // The frontend lane starts first, in the background: wasm packages and the
    // static bundle are host-side work that needs nothing from the service
    // build, so on a cold checkout they overlap cargo instead of following it.
    // The static bundle is joined just before `bring_up_app` creates the proxy
    // container that mounts it; Vite's dependencies before this returns. The
    // bundle is a snapshot: rebuilding service binaries leaves it alone, and
    // live frontend edits show on the dev server, not on it. Dry run:
    // synchronously, so the command preview prints in order.
    if plan.static_bundle && stage.is_dry_run() {
        frontend::build_static(stage, instance, mode)?;
    }
    let frontend_lane = (!stage.is_dry_run() && (plan.static_bundle || plan.vite)).then(|| {
        let instance = instance.clone();
        let stage = stage.background();
        let static_bundle = plan.static_bundle;
        std::thread::spawn(move || {
            if static_bundle {
                frontend::build_static(&stage, &instance, mode)
            } else {
                frontend::prepare(&stage)
            }
        })
    });

    // Run the teardown in the BACKGROUND: tearing the old stack down is
    // independent of the host-side build, so the two overlap instead of summing
    // (stopping ~20 containers is otherwise the slow part of a re-run).
    let teardown = if plan.start == Start::Fresh {
        BackgroundTeardown::start(stage, instance)
    } else {
        None
    };

    // Sharing posture (`--with-cf-tunnel`, local only): besides the tunnels,
    // the proxy additionally serves the headless static bundle, because that
    // bundle — built against the `same-origin` sentinel — is the only frontend
    // a remote visitor can actually use: the dev server's bundle calls the
    // backend on an absolute `localhost:<proxy>` origin. The dev server still
    // runs for the local developer. What a visitor can't do: follow
    // backend-generated absolute links (invite/login emails point at
    // `localhost:{FRONTEND_PORT}`) or the FusionAuth OAuth flow — passwordless
    // login works, with the code readable at `<tunnel>/mailpit`.
    let share_app = plan.share_app;
    if args.with_cf_tunnel && mode != Mode::Local {
        stage.note("--with-cf-tunnel is ignored by run_dev (tunnels share a fully local stack)");
    }

    // The Cursor egress tunnel, before env resolution because the minted
    // hostname overrides `AgentHarnessEgressUrl`. Best-effort with a loud
    // downgrade: a laptop with no route to Cloudflare should still get a
    // working stack, minus the one thing that needs public ingress -
    // `@cursor` sessions reaching local MCP servers.
    let egress_tunnel = (share_app && !stage.is_dry_run())
        .then(|| {
            match cf_tunnel::open(instance, "egress", instance.port(Port::AgentHarnessEgress)) {
                Ok(tunnel) => {
                    stage.note(&format!("cursor egress tunnel: {}", tunnel.url));
                    Some(tunnel)
                }
                Err(error) => {
                    stage.note(&format!(
                        "WARNING: no cursor egress tunnel ({error:#}); the egress URL stays \
                         in-network, so @cursor sessions cannot reach this stack's MCP servers"
                    ));
                    None
                }
            }
        })
        .flatten();

    // The preview SSH tunnel, also before env resolution: its hostname is what
    // the SharePreview script dials. A `tcp://` origin rather than the usual
    // `http://` — the far side is an SSH transport, not a web server — so the
    // agent reaches it through `cloudflared access ssh` as a ProxyCommand.
    // Without it a preview is still shareable, just only by an agent running on
    // this machine or in the compose network.
    let preview_ssh_tunnel = (share_app && !stage.is_dry_run())
        .then(|| {
            match cf_tunnel::open_tcp(instance, "preview-ssh", instance.port(Port::PreviewSsh)) {
                Ok(tunnel) => {
                    stage.note(&format!("preview ssh tunnel: {}", tunnel.hostname()));
                    Some(tunnel)
                }
                Err(error) => {
                    stage.note(&format!(
                        "WARNING: no preview ssh tunnel ({error:#}); agents off this machine \
                         cannot share a live preview"
                    ));
                    None
                }
            }
        })
        .flatten();
    // Borrowed by `prepare` below, so the guard itself has to outlive it.
    let preview_ssh_tunnel_host = preview_ssh_tunnel
        .as_ref()
        .map(|tunnel| tunnel.hostname().to_owned());

    // The app tunnel does not feed the env, but it degrades the same way: a
    // failure warns and the stack comes up localhost-only.
    let app_tunnel = (share_app && !stage.is_dry_run())
        .then(
            || match cf_tunnel::open(instance, "app", instance.port(Port::Proxy)) {
                Ok(tunnel) => {
                    stage.note(&format!("shared app tunnel: {}/app/", tunnel.url));
                    Some(tunnel)
                }
                Err(error) => {
                    stage.note(&format!(
                        "WARNING: no shared app tunnel ({error:#}); the app stays reachable \
                         on localhost only"
                    ));
                    None
                }
            },
        )
        .flatten();

    // Foreground: resolve env, build binaries + runtime image, generate the
    // compose override / Caddyfile / kickstart. None of this touches the volumes
    // or containers the teardown is removing, so it's safe to overlap.
    let egress_url = egress_tunnel.as_ref().map(|tunnel| tunnel.url.clone());
    // The open tunnels point at this window's ports, so it can't move under them.
    let pinned_base = args
        .instance
        .port_base
        .or(share_app.then_some(instance.port_base()));
    let (env, target) = prepare_on_free_window(
        stage,
        mode,
        instance,
        args,
        plan.static_bundle,
        plan.infra_only,
        plan.infra_only,
        local_env::Tunnels {
            egress: egress_url.as_deref(),
            preview_ssh: preview_ssh_tunnel_host.as_deref(),
        },
        pinned_base,
    )?;

    // The init snapshot decision: hash the init-defining inputs — possible only
    // after `prepare` wrote the kickstart — and check for a stored snapshot. A hit
    // skips migrate + Kafka topics + the ~1min FusionAuth kickstart + index
    // creation; a miss runs the real init and saves one, which is how the cache
    // seeds itself. The full-delete/full-create idempotency is unchanged: the
    // key *is* the definition of clean, so any input change is a structural miss.
    // Resuming keeps the volumes it would otherwise restore over.
    let snapshot_plan = (plan.start == Start::Fresh && !args.no_snapshot && !stage.is_dry_run())
        .then(|| snapshot::Plan::compute(instance))
        .transpose()?;

    // Join the background teardown before we (re)create volumes + bring infra up,
    // surfaced as a live spinner so it's clear what we're blocked on. It
    // overlapped the build above, so this is just whatever's left of stopping the
    // old containers — instant if it already finished.
    if let Some(teardown) = teardown {
        teardown.finish(stage)?;
    }
    // Both modes run at least Redis + LocalStack locally, and those reference the
    // instance's `external` volumes/networks — which must exist before compose
    // `up`. Unconditional + idempotent, mirroring the unconditional teardown (dev
    // was tearing `macro_redis_data` down each run but never recreating it).
    ensure_external_resources(stage, instance)?;

    // Bring the backend infra up and fully ready — DB created + migrated,
    // LocalStack provisioned, FusionAuth kickstarted — BEFORE the app services
    // start. The teardown means everything is freshly created each run, so
    // otherwise the services race their backends on startup (no `macrodb`,
    // DynamoDB/OpenSearch connection refused).
    match &snapshot_plan {
        Some(plan) if plan.exists() => {
            snapshot::restore(stage, instance, plan)?;
            bring_up_infra(stage, mode, instance, &env, InfraInit::FromSnapshot)?;
        }
        Some(plan) => {
            bring_up_infra(stage, mode, instance, &env, InfraInit::Full)?;
            snapshot::save(stage, instance, &env, plan)?;
        }
        None => bring_up_infra(stage, mode, instance, &env, InfraInit::Full)?,
    }
    let join_frontend = |label: &str, handle: std::thread::JoinHandle<Result<()>>| {
        stage.run_step(label, move || {
            handle
                .join()
                .map_err(|_| anyhow::anyhow!("frontend build panicked"))?
        })
    };
    let frontend_lane = match frontend_lane {
        Some(handle) if plan.static_bundle => {
            join_frontend("Building frontend (static bundle)", handle)?;
            None
        }
        other => other,
    };

    let shared_app_url = app_tunnel
        .as_ref()
        .map(|tunnel| format!("{}/app/", tunnel.url));
    let tunnels: Vec<cf_tunnel::QuickTunnel> = [egress_tunnel, preview_ssh_tunnel, app_tunnel]
        .into_iter()
        .flatten()
        .collect();

    if plan.infra_only {
        // No app stack, no proxy: nothing to gate on, and no recorded state —
        // `update`/`status` on an infra-only bake should say "bring the stack up
        // first" rather than assume a running app.
        stage.note("  infra-only: app services, proxy, and frontend skipped");
        return Ok(StackUp {
            env,
            target,
            tunnels,
            shared_app_url,
        });
    }

    // Pin a Nix binary set before anything mounts it. Dry runs may have no
    // binaries at all.
    let active_binaries = if stage.is_dry_run() {
        None
    } else {
        let configured = args
            .build
            .binaries_dir
            .clone()
            .unwrap_or_else(|| workspace_root().join(target.debug_dir()));
        let binaries = build::BinariesDir::classify(&configured)?;
        binaries.pin_gc_root(&instance.artifact_dir())?;
        Some(binaries.host_dir().to_path_buf())
    };

    // Containers on a fresh start are new, so they start on the binaries built
    // above. (Reloading binaries into a running stack is `reload_services`' job.)
    bring_up_app(stage, mode, instance, &env)?;
    // The new containers hold today's images now, so older tags can go.
    gen_compose::prune_content_tagged_images();
    // A resumed stack's containers can predate the binaries this run just built.
    // A prebuilt `--binaries-dir` is adopted through the compose mount instead.
    if plan.start == Start::Resume && args.build.binaries_dir.is_none() && !stage.is_dry_run() {
        reload_changed_services(stage, mode, instance, &env, target)?;
    }
    let _sdk_webhook_tunnel = (mode == Mode::Local && !stage.is_dry_run())
        .then(|| sdk_webhook::start(instance))
        .transpose()?;

    // "Ready" means the backend answers through the proxy — the caller (a CI step,
    // an agent) acts on the URL the moment this returns.
    if mode.spec().wait_backend_before_frontend {
        frontend::wait_backend_ready(stage, instance)?;
    }
    if let Some(handle) = frontend_lane {
        join_frontend("Preparing frontend dependencies (background)", handle)?;
    }

    if !stage.is_dry_run() {
        stack::record(
            instance,
            mode,
            args,
            plan,
            active_binaries,
            egress_url.clone(),
            preview_ssh_tunnel_host.clone(),
        )?;
        build::BinariesDir::release_previous_gc_root(&instance.artifact_dir());
    }
    Ok(StackUp {
        env,
        target,
        tunnels,
        shared_app_url,
    })
}

/// Print the ready summary for a finished [`bring_up`].
pub(crate) fn print_stack_summary(
    mode: Mode,
    instance: &Instance,
    up: &StackUp,
    plan: &BringUp,
) -> Result<()> {
    // A static bundle moves the Mailpit UI under `/mailpit` (MP_WEBROOT, so a
    // remote visitor can read their login code through the proxy); show the URL
    // that actually resolves.
    let mailpit_url = if plan.static_bundle {
        mailpit::proxy_ui_url(instance)
    } else {
        mailpit::direct_ui_url(instance)
    };
    let frontend_url = if plan.vite {
        frontend::https_url(instance)?
    } else if plan.static_bundle {
        frontend::static_url(instance)
    } else {
        "(disabled — --no-frontend)".to_string()
    };
    summary::print(
        mode,
        instance,
        &up.env,
        &frontend_url,
        &mailpit_url,
        up.shared_app_url.as_deref(),
    );
    Ok(())
}

/// `just run_local` / `just run_dev`: attached to a terminal with the hotkey loop
/// when there is one, otherwise in the background. Run from the attached flow only
/// if both stdin and stdout are terminals, so an agent's Bash tool, a pipe, or CI
/// never blocks on a dev server it can't talk to.
pub fn run_stack(mode: Mode, run: &cli::RunLocalArgs) -> Result<()> {
    use std::io::IsTerminal;

    if let Some(action) = &run.action {
        return supervisor::run_action(action);
    }
    if run.flags.supervise {
        return supervisor::supervise(mode, &run.flags, &run.run);
    }
    let stage = Stage::from_env_cli(run.run.verbose);
    let attached = std::io::stdin().is_terminal() && std::io::stdout().is_terminal();
    if !stage.is_dry_run() && (run.flags.detach || !attached) {
        return supervisor::start_detached(&run.flags, &run.run);
    }
    run_attached(stage, mode, run)
}

/// Bring the stack up in this process, then stay attached with hotkeys. Always a
/// full delete + full create: a person at a terminal expects a clean slate.
fn run_attached(mut stage: Stage, mode: Mode, run: &cli::RunLocalArgs) -> Result<()> {
    let args = &run.run;
    if mode.spec().runs_local_infra {
        // This mode will provision Kafka topics mid-bring-up; reject a build
        // that can't do that before any containers start.
        kafka::ensure_available(&format!("run-{}", mode.label()))?;
    }
    let mut instance = allocator::allocate(
        &stage,
        mode,
        args.instance.instance.as_deref(),
        args.instance.port_base,
    )?;
    stage.section(&format!(
        "macro {} stack — instance {}",
        mode.label(),
        instance.name()
    ));
    let plan = supervisor::plan_for(mode, &run.flags, args, Start::Fresh);
    let attached_run = (!stage.is_dry_run())
        .then(|| supervisor::begin_attached(&instance))
        .transpose()?;
    if let Some(attached) = &attached_run {
        stage = stage.with_job(std::sync::Arc::clone(&attached.job));
    }
    let stage = &stage;

    let result = (|| {
        let up = bring_up(stage, mode, &mut instance, args, &plan)?;
        // Mirror `env_layer::resolve`'s port probe: if the collector never came
        // up (best-effort default backend), don't point the browser exporter at a
        // dead endpoint.
        let frontend = if plan.vite {
            frontend::start(
                stage,
                &instance,
                mode,
                args.traces.enabled() && summary::port_open(4318),
            )?
        } else {
            stage.note("frontend disabled (--no-frontend)");
            None
        };
        stage.print_timings("bring-up");
        print_stack_summary(mode, &instance, &up, &plan)?;
        Ok((up, frontend))
    })();
    let (up, frontend) = match &attached_run {
        Some(attached) => attached.finish(result)?,
        None => result?,
    };

    if let Some(mut fe) = frontend {
        interact(
            stage,
            mode,
            &instance,
            &up.env,
            up.target,
            args.build.build_aux_services,
            &mut fe,
        )?;
    }
    Ok(())
}

/// Print the hotkey legend shown while attached to a running stack.
fn print_hotkeys(stage: &Stage) {
    stage.note(
        "  [r] rebuild & reload services   [f] restart Vite   [q] quit (tears the stack down)",
    );
}

/// Re-build the service binaries on the host and restart only the containers
/// whose binary actually changed — the body of the `r` hotkey. The binaries are
/// bind-mounted at `/app/out`, so a rebuild updates them in-place; the container
/// just needs to re-exec. We snapshot binary mtimes around the build so a small
/// change relinks (and restarts) one or two services, not all twelve — and a
/// no-op build restarts nothing. Runs under a single parent spinner (quiet
/// sub-stage) so a reload is one resolving line.
fn rebuild_and_reload(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    target: arch::Target,
    build_aux_services: bool,
    only: Option<&[&'static inventory::RustService]>,
) -> Result<Vec<String>> {
    if stage.is_verbose() {
        // Run each step on the parent stage so the build (per group) and the
        // reload each show their own `Done <elapsed>` — the build-vs-reload
        // split — rather than folding into one line.
        run_rebuild(stage, mode, instance, env, target, build_aux_services, only)
    } else {
        let mut reloaded = Vec::new();
        stage.run_step("Rebuilding & reloading services", || {
            reloaded = run_rebuild(
                &stage.quiet(),
                mode,
                instance,
                env,
                target,
                build_aux_services,
                only,
            )?;
            Ok(())
        })?;
        Ok(reloaded)
    }
}

/// Rebuild, then restart only the services running an older binary than the one
/// on disk. Runs on a quiet sub-stage when folded, or the parent stage under
/// `--verbose` so each step times itself. Returns the reloaded service names.
///
/// `only` rebuilds just those services; the others keep their binaries, and
/// [`staleness`] records which of them now run older code than the tree.
fn run_rebuild(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    target: arch::Target,
    build_aux_services: bool,
    only: Option<&[&'static inventory::RustService]>,
) -> Result<Vec<String>> {
    let mark = staleness::BuildMark::now(&repo_root());
    let options = build::BuildOptions {
        no_build: false,
        binaries_dir: None,
        only: only.map(<[_]>::to_vec),
    };
    if build_aux_services {
        std::thread::scope(|scope| {
            let rust_build = scope.spawn(|| build::resolve(stage, target, &options));
            let aux_build = scope.spawn(|| build_aux_service_images(stage, instance, env));
            let binaries = rust_build
                .join()
                .map_err(|_| anyhow::anyhow!("Rust service build panicked"))?;
            let aux = aux_build
                .join()
                .map_err(|_| anyhow::anyhow!("auxiliary service build panicked"))?;
            binaries?;
            aux
        })?;
    } else {
        build::resolve(stage, target, &options)?;
    }
    if build_aux_services {
        recreate_aux_service_containers(stage, instance, env)?;
    }
    let reloaded = reload_changed_services(stage, mode, instance, env, target)?;
    record_builds(stage, instance, mode, mark, only);
    Ok(reloaded)
}

/// Record what each service was just built from, for [`staleness`]. A failure
/// only loses the stale list, so it is reported, not raised. A dry run built
/// nothing, so it records nothing.
fn record_builds(
    stage: &Stage,
    instance: &Instance,
    mode: Mode,
    mark: Result<staleness::BuildMark>,
    only: Option<&[&'static inventory::RustService]>,
) {
    if stage.is_dry_run() {
        return;
    }
    let all: Vec<&inventory::RustService> = inventory::services_for_mode(mode).collect();
    let recorded = mark.and_then(|mark| match only {
        None => staleness::record_full(instance, &mark, all.iter().copied()),
        Some(built) => {
            staleness::record_partial(instance, &repo_root(), &mark, built, &all).map(|_| ())
        }
    });
    if let Err(error) = recorded {
        staleness::clear(instance);
        eprintln!("could not record which services are on older code: {error:#}");
    }
}

/// Recreate each service whose binary is newer than its container, and return
/// their names. Comparing against the running container rather than a snapshot
/// taken before the build means a build that relinked some services and then
/// failed, or was killed, still gets those services reloaded next time.
fn reload_changed_services(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    target: arch::Target,
) -> Result<Vec<String>> {
    let containers = docker::project_containers(instance.project_name())?;
    let changed: Vec<&inventory::RustService> = inventory::services_for_mode(mode)
        .filter(|svc| {
            let Some(built) = binary_mtime(target, svc) else {
                return false;
            };
            containers
                .iter()
                .find(|c| c.service.as_deref() == Some(svc.compose_name))
                .is_some_and(|c| binary_is_newer(built, c.created))
        })
        .collect();
    if !changed.is_empty() {
        reload_services(stage, instance, env, &changed)?;
    }
    Ok(changed
        .into_iter()
        .map(|svc| svc.compose_name.to_owned())
        .collect())
}

/// Whether a binary built at `built` (unix seconds) was written after a container
/// created at `created` started from it.
fn binary_is_newer(built: i64, created: i64) -> bool {
    built > created
}

/// Modification time of a service's built binary, in unix seconds (`None` if
/// absent).
fn binary_mtime(target: arch::Target, svc: &inventory::RustService) -> Option<i64> {
    let path = workspace_root()
        .join(target.debug_dir())
        .join(svc.cargo_bin);
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    let since_epoch = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since_epoch.as_secs()).ok()
}

/// Stay attached to the running stack, handling hotkeys until the user quits or
/// the frontend exits. `r` rebuilds + reloads the services; `f` restarts Vite;
/// `q`/Esc/Ctrl-C stops
/// the frontend and tears the whole stack down (so the next run starts clean and
/// fast). An unexpected frontend exit just returns, leaving the stack up for
/// inspection — the next run's start-of-run teardown will reclaim it.
fn interact(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    target: arch::Target,
    build_aux_services: bool,
    fe: &mut frontend::Frontend,
) -> Result<()> {
    use console::Key;

    let term = console::Term::stdout();
    print_hotkeys(stage);
    loop {
        // Noticed on the next keypress; the frontend running silently is fine.
        if let Some(status) = fe.process.child.try_wait()? {
            let out = fe.tail_output(40);
            if !out.trim().is_empty() {
                stage.note("frontend output (last lines):");
                for line in out.lines() {
                    println!("  {line}");
                }
            }
            stage.note(&format!("frontend dev server exited ({status})"));
            return Ok(());
        }
        match term.read_key() {
            Ok(Key::Char('r' | 'R')) => {
                // Drop the legend so the rebuild's single resolved line slots in
                // above a freshly reprinted legend (pinned to the bottom) rather
                // than the whole block stacking on each press.
                let _ = term.clear_last_lines(1);
                // run_step renders ✗ + the captured build error on failure; keep
                // the loop alive so the user can fix and press `r` again.
                let _ = telemetry::RunTelemetry::action(instance, telemetry::RunKind::Rebuild, || {
                    rebuild_and_reload(
                        stage,
                        mode,
                        instance,
                        env,
                        target,
                        build_aux_services,
                        None,
                    )
                });
                print_hotkeys(stage);
            }
            Ok(Key::Char('f' | 'F')) => {
                let _ = term.clear_last_lines(1);
                // A failed restart returns with captured output and leaves the
                // backend containers running, like an unexpected frontend exit.
                telemetry::RunTelemetry::action(
                    instance,
                    telemetry::RunKind::RestartFrontend,
                    || fe.restart(stage),
                )?;
                print_hotkeys(stage);
            }
            Ok(Key::Char('q' | 'Q') | Key::Escape | Key::CtrlC) | Err(_) => {
                // Kill the frontend's whole process group (bun + Vite), not just
                // bun — otherwise Vite is orphaned and keeps holding the port.
                fe.shutdown();
                // Tear the stack down on quit, while the user is already leaving:
                // stopping the running containers now is the slow part of
                // teardown, so doing it here makes the *next* `run_local` skip it
                // (its start-of-run teardown then has nothing to stop). Best-effort
                // — we're exiting regardless.
                let _ = teardown(stage, instance);
                let _ = allocator::release(instance);
                let _ = stack::clear_state(instance);
                return Ok(());
            }
            _ => {}
        }
    }
}

/// The shared front half of every stack flow: resolve the env, ensure the
/// runtime image + service binaries, and generate the compose override /
/// Caddyfile / kickstart. Deliberately does NOT create the external
/// networks/volumes — that's done after the background teardown joins, since
/// teardown removes them. `static_frontend` wires the proxy to serve the staged
/// app bundle (`stack up`, `run_local --static-frontend`, and
/// `run_local --with-cf-tunnel`'s shared app). `infra_only` skips the service build: bake never
/// starts Rust services and runs in parallel with the cargo lane. Returns the
/// resolved env + build target.
///
/// One argument per independent knob; bundling some into a struct would only
/// move the same list one level down.
#[allow(clippy::too_many_arguments)]
fn prepare(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    args: &cli::RunArgs,
    static_frontend: bool,
    pull_app_images: bool,
    infra_only: bool,
    tunnels: local_env::Tunnels<'_>,
) -> Result<(env_layer::ResolvedEnv, arch::Target)> {
    let env = env_layer::resolve(
        mode,
        instance,
        args.env.no_doppler,
        args.env.env_file.as_deref(),
        static_frontend,
        tunnels,
        args.traces.enabled(),
    )?;
    stage.note(&format!("env: {}", env_layer::summarize(&env.merged)));
    sandbox_image::ensure(stage, &env.merged, args.build.no_build)?;

    // Build the runtime image (idempotent) and the service binaries.
    let target = arch::detect()?;
    build::ensure_runtime_image(stage, target, false)?;
    let binaries = if infra_only {
        // Compose still emits `/app/out` mounts, but infra-only never starts
        // those services. Bake runs this in parallel with the service build.
        build::BinariesDir::TargetDir(workspace_root().join(target.debug_dir()))
    } else {
        let mark = staleness::BuildMark::now(&repo_root());
        let binaries = build::resolve(
            stage,
            target,
            &build::BuildOptions {
                no_build: args.build.no_build,
                binaries_dir: args.build.binaries_dir.clone(),
                only: None,
            },
        )?;
        if args.build.no_build || args.build.binaries_dir.is_some() {
            // Not built here, so nothing to compare a later partial rebuild to.
            staleness::clear(instance);
        } else {
            record_builds(stage, instance, mode, mark, None);
        }
        binaries
    };

    // Generate the override + the Caddyfile (the frontend reaches the services
    // through the proxy in every mode), and — for the self-contained local
    // stacks — the FusionAuth kickstart. (External networks/volumes are created
    // by the caller after the background teardown joins.)
    let gmail_forwarder = env
        .merged
        .get("GMAIL_FORWARDER_SA_KEY")
        .is_some_and(|key| !key.trim().is_empty());
    gen_compose::generate(mode, instance, &binaries, static_frontend, gmail_forwarder)?;
    proxy::write_caddyfile(instance, mode, static_frontend)?;
    if mode == Mode::Local {
        portmap::write(instance)?;
    }
    if mode.spec().runs_local_infra {
        let google = kickstart::GoogleIdp::from_env(&env.merged);
        let github = kickstart::GithubIdp::from_env(&env.merged);
        fusionauth::write_kickstart(instance, google.as_ref(), github.as_ref())?;
    }
    if args.build.build_aux_services {
        build_aux_service_images(stage, instance, &env)?;
    }
    if pull_app_images {
        pull_app_service_images(stage, instance, &env)?;
    }
    Ok((env, target))
}

/// [`prepare`], then make sure the port window survived the build. A tool that
/// doesn't use the allocator (an older checkout, anything on the host) can take a
/// port meanwhile, and finding out at `docker compose up` would waste the build.
/// If so, regenerate on another window; the second build has nothing to compile.
/// `pinned_base` is a window that mustn't move, which fails here instead.
#[expect(
    clippy::too_many_arguments,
    reason = "prepare's knobs, passed straight through, plus the pinned window"
)]
fn prepare_on_free_window(
    stage: &Stage,
    mode: Mode,
    instance: &mut Instance,
    args: &cli::RunArgs,
    static_frontend: bool,
    pull_app_images: bool,
    infra_only: bool,
    tunnels: local_env::Tunnels<'_>,
    pinned_base: Option<u16>,
) -> Result<(env_layer::ResolvedEnv, arch::Target)> {
    loop {
        let prepared = prepare(
            stage,
            mode,
            instance,
            args,
            static_frontend,
            pull_app_images,
            infra_only,
            tunnels,
        )?;
        let current = allocator::allocate(stage, mode, Some(instance.name()), pinned_base)?;
        if current.port_base() == instance.port_base() {
            *instance = current;
            return Ok(prepared);
        }
        stage.note(&format!(
            "port window {} was taken during the build; moving to {}",
            instance.port_base(),
            current.port_base()
        ));
        *instance = current;
    }
}

/// A `docker compose` command wired for this instance's full file set + the
/// generated env. Shared by bring-up and the binary-reload restart.
fn compose_cmd(instance: &Instance, env: &env_layer::ResolvedEnv) -> Command {
    let files = gen_compose::compose_files(instance);
    gen_compose::docker_compose(instance, &files, &env.generated_path)
}

fn build_aux_service_images(
    stage: &Stage,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
) -> Result<()> {
    let mut build = compose_cmd(instance, env);
    build.arg("build").args(LOCAL_BUILD_SERVICE_IMAGES);
    stage.run("Building auxiliary service images", &mut build)
}

fn pull_app_service_images(
    stage: &Stage,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
) -> Result<()> {
    let mut pull = compose_cmd(instance, env);
    pull.arg("pull").args(LOCAL_PULL_SERVICE_IMAGES);
    stage.run("Pulling image-only app services", &mut pull)
}

fn recreate_aux_service_containers(
    stage: &Stage,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
) -> Result<()> {
    let mut up = compose_cmd(instance, env);
    up.args(["up", "-d", "--force-recreate", "--no-deps"])
        .args(LOCAL_RECREATE_SERVICE_IMAGES);
    stage.run("Recreating auxiliary service containers", &mut up)
}

/// How the local infra reaches its initialized state on bring-up.
#[derive(Clone, Copy, PartialEq, Eq)]
enum InfraInit {
    /// Run the real init: migrate the DB, let FusionAuth apply its kickstart,
    /// create the OpenSearch indices.
    Full,
    /// The volumes were restored from an init snapshot — the state already
    /// exists, so the init steps are skipped (LocalStack is provisioned either
    /// way; its state isn't volume-backed).
    FromSnapshot,
}

/// Bring up the backend infra the app services connect to at startup, and get it
/// fully ready before any of them start. The clean-slate teardown means
/// everything is freshly created each run, so this ordering is what stops the
/// services racing their backends (missing `macrodb`, DynamoDB/OpenSearch
/// refused). Dev points Postgres/OpenSearch/FusionAuth at shared dev resources,
/// so it only runs Redis + LocalStack locally.
fn bring_up_infra(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    init: InfraInit,
) -> Result<()> {
    if stage.is_dry_run() {
        return Ok(());
    }
    let spec = mode.spec();

    // `--wait` gates on each service's healthcheck. Postgres (`pg_isready`) and
    // OpenSearch (HTTP) have patient ones, so this blocks until they genuinely
    // accept connections — not just an open port (Docker's proxy accepts before
    // the server is ready, which is why a plain TCP probe let sqlx hit a
    // not-ready Postgres). Redis + LocalStack have no healthcheck, so `--wait`
    // only confirms "running"; LocalStack readiness is polled below. FusionAuth
    // is deliberately excluded — its healthcheck gives up (5 retries) long before
    // its ~minute kickstart finishes, so it's started + polled separately.
    let waited: &[&str] = if spec.runs_local_infra {
        &["postgres", "redis", "search", "kafka", "localstack"]
    } else {
        &["redis", "kafka", "localstack"]
    };
    // FusionAuth needs only its own database, so it boots alongside the rest
    // of the infra instead of after it: its JVM start is the longest wait here.
    let fusionauth_start = spec.runs_local_infra.then(|| {
        let mut fa = compose_cmd(instance, env);
        fa.arg("up").arg("-d").arg("fusionauth");
        let stage = stage.background();
        std::thread::spawn(move || stage.run("Starting FusionAuth", &mut fa))
    });
    // LocalStack is ready within seconds, long before OpenSearch: poll its API
    // and provision S3/SQS/DynamoDB while compose waits on the rest. Compose
    // also waits for LocalStack's healthcheck, so once it returns the lane
    // takes one last look instead of polling on (a cold machine may spend
    // minutes pulling images before the container exists).
    let (infra_done, infra_done_rx) = std::sync::mpsc::channel::<()>();
    let localstack_lane = {
        let instance = instance.clone();
        let stage = stage.background();
        std::thread::spawn(move || {
            let health = format!(
                "http://localhost:{}/_localstack/health",
                instance.port(Port::LocalStack)
            );
            stage.run_step("Waiting for LocalStack", || {
                wait_localstack(&health, &infra_done_rx)
            })?;
            stage.run_step("Provisioning LocalStack", || {
                localstack::provision(&instance)
            })
        })
    };
    let mut up = compose_cmd(instance, env);
    up.arg("up").arg("-d").arg("--wait").args(waited);
    let infra = stage.run("Starting infra (docker compose up -d --wait)", &mut up);
    let _ = infra_done.send(());
    let fusionauth_started = fusionauth_start.map(|handle| {
        handle
            .join()
            .map_err(|_| anyhow::anyhow!("starting FusionAuth panicked"))?
    });
    let localstack_ready = localstack_lane
        .join()
        .map_err(|_| anyhow::anyhow!("provisioning LocalStack panicked"))?;
    infra?;
    fusionauth_started.transpose()?;
    localstack_ready?;

    if spec.migrates_db && init == InfraInit::Full {
        // Postgres is ready (`--wait`); create + migrate the freshly-wiped DB.
        db::migrate(stage, instance)?;
    }
    if spec.runs_local_infra {
        // Kafka is healthy (`--wait` gates on its broker healthcheck); create
        // the event topics declared in `macro_event_topics` — the local
        // equivalent of the MSK topic provisioning driven by the generated
        // `.github/kafka-cluster-topics.json`. Restored volumes already carry
        // the topics (they live in the broker's data dir), so only a full init
        // provisions — which also means a snapshot-restoring `stack up`
        // never needs the rdkafka-backed `local-stack` feature.
        if init == InfraInit::Full {
            stage.run_step("Creating Kafka topics", || kafka::provision(instance))?;
        }

        // FusionAuth was started above without `--wait` (its healthcheck is
        // impatient); poll it patiently until it's up. On a full init that wait
        // covers the ~minute kickstart; on a snapshot restore the kickstart is
        // already in the restored volumes, so this is just JVM boot.
        fusionauth::wait_ready(stage, instance)?;
        fusionauth::apply_redirect_urls(stage, instance)?;

        // OpenSearch is up (`--wait`) but empty. Create the search indices +
        // aliases (idempotent) so the unified search path works out of the box
        // instead of 404ing on the missing `documents`/`chats`/… indices.
        // Restored volumes already contain them.
        if init == InfraInit::Full {
            opensearch::provision_indices(stage, instance, &env.merged)?;
        }
    }
    Ok(())
}

/// Bring up the app (Rust) services once the infra is ready. For local, `up`
/// with no service args starts everything — the app services plus the auxiliary
/// containers (sync/websocket/lexical/mailpit/proxy/…) — with the already-running
/// infra a no-op, so inter-service start order is unchanged from before. Dev
/// starts only the binaries + proxy (its local infra is already up).
fn bring_up_app(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
) -> Result<()> {
    let mut up = compose_cmd(instance, env);
    up.arg("up").arg("-d").arg("--remove-orphans");
    if !mode.spec().runs_local_infra {
        for svc in inventory::services_for_mode(mode) {
            up.arg(svc.compose_name);
        }
        up.arg("proxy");
    }
    stage.run("Starting services (docker compose up -d)", &mut up)?;
    connect_tracing_network(instance);
    Ok(())
}

/// Start the requested trace collector (`--traces`) under its own compose
/// project, the same one a developer would use manually — see
/// `docker/docker-compose.yml`'s `jaeger`/`datadog-agent` services. Global and
/// idempotent (like `start_localstack`): one collector per machine, shared
/// across instances, left running across `run_local` invocations.
fn ensure_tracing_backend(stage: &Stage, backend: cli::TracesBackend) -> Result<()> {
    let (Some(profile), Some(service)) = (backend.compose_profile(), backend.compose_service())
    else {
        return Ok(()); // --traces off
    };
    // A keyed backend with a missing key accepts telemetry locally and drops
    // every payload at the vendor intake (403), which looks like "traces are
    // broken" rather than "key is missing" — so fail loud up front.
    if let Some(var) = backend.required_env()
        && macro_env_var::maybe_read_env(var).is_none_or(|v| v.is_empty())
    {
        anyhow::bail!(
            "--traces {profile} requires the {var} env var to be set (export it in \
             the shell you run this from)"
        );
    }
    evict_other_collector(stage, service);
    let result =
        start_global_compose_service(stage, profile, service, "trace collector").and_then(|()| {
            // `up -d` returns once the container starts, not once it's accepting
            // connections; `env_layer::resolve` (which runs right after this, in
            // `prepare`) needs the OTLP port live NOW to decide whether to wire
            // `OTEL_EXPORTER_OTLP_ENDPOINT`, so wait for it here instead of
            // racing. 30s: the LGTM all-in-one is the heaviest collector and
            // takes 10-20s on a cold volume.
            for _ in 0..300 {
                if summary::port_open(4318) {
                    return Ok(());
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            anyhow::bail!("{profile} trace collector did not come up on port 4318 in time")
        });
    // The default backend must not brick a run that never asked for tracing
    // (offline, image pull failure): warn loud and continue without export —
    // the env probe simply won't wire `OTEL_EXPORTER_OTLP_ENDPOINT`. An
    // explicitly keyed backend still fails hard above.
    match result {
        Err(e) if backend == cli::TracesBackend::Lgtm => {
            stage.note(&format!(
                "  WARNING: could not start the lgtm trace collector ({e:#}); \
                 continuing without tracing (`--traces off` silences this)"
            ));
            Ok(())
        }
        other => other,
    }
}

/// Remove a *different* collector holding the OTLP ports before starting the
/// requested one. All backends bind 4317/4318, so a leftover collector from a
/// previous `--traces` choice would otherwise win the port race and keep
/// receiving the telemetry — silently, since the port probe only asks "is
/// something listening", not "is it the backend that was asked for".
fn evict_other_collector(stage: &Stage, wanted_service: &str) {
    if !summary::port_open(4318) {
        return;
    }
    let Some(holder) = Command::new("docker")
        .args(["ps", "--filter", "publish=4318", "--format", "{{.Names}}"])
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|name| !name.is_empty())
    else {
        return; // not a docker container (host collector) — leave it alone
    };
    // Compose names containers `<project>-<service>-<n>`.
    if holder.contains(&format!("-{wanted_service}-")) {
        return;
    }
    stage.note(&format!(
        "  replacing running trace collector {holder} (all collectors share the OTLP ports)"
    ));
    let _ = Command::new("docker").args(["rm", "-f", &holder]).output();
}

/// Start a profile-gated service from the base compose file under the global
/// `macro` project (one per machine, shared across instances, left running
/// across invocations) — the pattern the trace collectors and headless Chrome
/// share. Keep other containers in the shared project: the base compose file
/// does not include generated infrastructure services such as LocalStack.
fn start_global_compose_service(
    stage: &Stage,
    profile: &str,
    service: &str,
    label: &str,
) -> Result<()> {
    let compose = repo_root().join("docker/docker-compose.yml");
    let mut up = Command::new("docker");
    up.arg("compose")
        .arg("--project-directory")
        .arg(repo_root())
        .arg("-f")
        .arg(&compose)
        .arg("--profile")
        .arg(profile)
        .arg("up")
        .arg("-d")
        .arg(service);
    stage.run(&format!("Starting {profile} {label}"), &mut up)
}

/// Start the shared headless Chrome (compose profile `chrome`, CDP on 9222)
/// that agents drive over the DevTools protocol — see the `headless-chrome`
/// service in `docker/docker-compose.yml` and the `live-debug` skill.
/// Best-effort: a machine that can't pull the image still gets a full stack.
fn ensure_headless_chrome(stage: &Stage) {
    if summary::port_open(9222) {
        return; // already running (ours or a host Chrome — either works)
    }
    if let Err(e) = start_global_compose_service(stage, "chrome", "headless-chrome", "browser") {
        stage.note(&format!(
            "  WARNING: could not start headless Chrome ({e:#}); browser \
             debugging via CDP on :9222 will be unavailable"
        ));
    }
}

/// If the global trace collector (Jaeger or the Datadog agent) is running,
/// attach it to this instance's `services` network under the `otel-collector`
/// alias that the injected `OTEL_EXPORTER_OTLP_ENDPOINT` points at (see
/// `env_layer::resolve`). The collectors are started under their own compose
/// project (`docker/docker-compose.yml`, profiles `jaeger`/`datadog`), and
/// Compose prefixes networks per project — so without this, instance
/// containers can't resolve `otel-collector` and span exports fail with DNS
/// errors. Best-effort: "already connected" (rerun) and other failures are
/// ignored, they only mean traces don't flow.
fn connect_tracing_network(instance: &Instance) {
    if !summary::port_open(4318) {
        return;
    }
    // Find the collector container (Jaeger or Datadog agent — both publish the
    // OTLP HTTP port) by that port rather than assuming a container name, in
    // case it was started under a different project.
    let Some(collector) = Command::new("docker")
        .args(["ps", "--filter", "publish=4318", "--format", "{{.Names}}"])
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|name| !name.is_empty())
    else {
        return;
    };
    let _ = Command::new("docker")
        .args(["network", "connect", "--alias", "otel-collector"])
        .arg(instance.network_services())
        .arg(collector)
        .output();
}

/// Undo [`connect_tracing_network`] before teardown. The collector lives in a
/// different compose project, and Docker refuses to remove a network with a
/// foreign container still attached — without this, every `compose down`
/// leaves the instance's `services` network behind ("active endpoints",
/// silently swallowed). Best-effort like its counterpart.
fn disconnect_tracing_network(instance: &Instance) {
    let network = instance.network_services();
    let Some(attached) = Command::new("docker")
        .args([
            "network",
            "inspect",
            &network,
            "--format",
            "{{range .Containers}}{{.Name}}\n{{end}}",
        ])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
    else {
        return;
    };
    // Foreign means "not this compose project". Decide by the compose project
    // label, not the container name: the global collector `macro-lgtm-1`
    // (project `macro`, service `lgtm`) is name-indistinguishable from a
    // container of an instance literally named `lgtm` (project `macro-lgtm`).
    // One `docker inspect` for all attached containers, not one per name.
    let names: Vec<&str> = attached
        .lines()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .collect();
    if names.is_empty() {
        return;
    }
    let Some(labeled) = Command::new("docker")
        .args(["inspect", "--format"])
        .arg(r#"{{.Name}} {{index .Config.Labels "com.docker.compose.project"}}"#)
        .args(&names)
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
    else {
        return;
    };
    for line in labeled.lines() {
        // `{{.Name}}` carries a leading slash.
        let Some((name, project)) = line.split_once(' ') else {
            continue;
        };
        if project != instance.project_name() {
            let _ = Command::new("docker")
                .args(["network", "disconnect", "-f", &network])
                .arg(name.trim_start_matches('/'))
                .output();
        }
    }
}

/// Recreate the given services' containers so they re-exec their freshly built
/// binaries (bind-mounted at `/app/out`) under the current env file. No
/// graceful-stop grace, and only the changed containers, so a reload after a
/// small change bounces one or two services rather than all twelve. Touching
/// only the changed subset also avoids the `depends_on` race a full restart
/// hits (a service coming back before a peer it depends on).
fn reload_services(
    stage: &Stage,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    services: &[&inventory::RustService],
) -> Result<()> {
    if stage.is_dry_run() {
        return Ok(());
    }
    // Recreate rather than `docker restart`: a restart keeps the env the
    // container was created with, so a build that needs a newly required var
    // would crash-loop even though the regenerated env file carries it.
    let mut up = compose_cmd(instance, env);
    up.args([
        "up",
        "-d",
        "--force-recreate",
        "--no-deps",
        "--timeout",
        "0",
    ]);
    for svc in services {
        up.arg(svc.compose_name);
    }
    let names = services
        .iter()
        .map(|s| s.compose_name)
        .collect::<Vec<_>>()
        .join(", ");
    stage.run(&format!("Reloading {names}"), &mut up)
}

/// Every Docker volume an instance owns: the app DB/cache/search/Kafka plus the
/// FusionAuth DB/config. The single list `teardown`, `ensure_external_resources`,
/// and `destroy` share.
fn instance_volumes(instance: &Instance) -> [String; 6] {
    [
        instance.volume_postgres(),
        instance.volume_redis(),
        instance.volume_opensearch(),
        instance.volume_kafka(),
        instance.volume_fusionauth_db(),
        instance.volume_fusionauth_config(),
    ]
}

/// Whether the instance already has any data volume, which a bring-up must not
/// wipe without being told to.
pub(crate) fn instance_has_volumes(instance: &Instance) -> Result<bool> {
    for volume in instance_volumes(instance) {
        if docker::volume_exists(&volume)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The docker teardown work: stop + remove the instance's stack and ALL its
/// stateful volumes — the basis of `run_local`'s full-delete/full-create
/// idempotency, the quit hotkey, and `destroy-local`. Containers come down with
/// `down -v`; the data volumes and a named instance's networks are then removed
/// explicitly, because they are declared `external`, which `down -v` leaves
/// behind. A stack that's gone must not keep holding subnets. The default
/// instance's networks are shared with the base compose files, so they stay.
/// Output is captured (this is best-effort and noisy) so callers surface it as a
/// single line; absent containers/volumes are ignored.
fn teardown_commands(instance: &Instance) {
    sdk_webhook::stop(instance);
    // Detach the global trace collector first or `down` can't remove the
    // instance's `services` network (foreign container = active endpoint).
    disconnect_tracing_network(instance);
    let project = instance.project_name();
    // `-t 0`: SIGKILL immediately, no graceful-shutdown grace. The default 10s
    // SIGTERM timeout per container (Postgres' smart shutdown, OpenSearch, …)
    // dominates teardown — and we're wiping the volumes anyway, so a clean
    // shutdown buys nothing.
    let _ = Command::new("docker")
        .args([
            "compose",
            "-p",
            project,
            "down",
            "-v",
            "--remove-orphans",
            "-t",
            "0",
        ])
        .output();
    for vol in instance_volumes(instance) {
        let _ = Command::new("docker")
            .args(["volume", "rm", "-f", &vol])
            .output();
    }
    if !instance.is_default() {
        for (network, _) in instance.networks() {
            let _ = Command::new("docker")
                .args(["network", "rm", &network])
                .output();
        }
    }
}

/// [`teardown_commands`] shown as a single progress row (for the quit hotkey and
/// `destroy-local`). `run_local` instead runs it in the background — see
/// `run_stack`.
fn teardown(stage: &Stage, instance: &Instance) -> Result<()> {
    if stage.is_dry_run() {
        return Ok(());
    }
    stage.run_step("Tearing down stack", || {
        teardown_commands(instance);
        Ok(())
    })
}

/// [`teardown_commands`] on a background thread, overlapping a start's build.
/// Dropping it waits for the teardown, so a start that fails before joining
/// can't exit halfway through and leave some of the instance's networks behind.
struct BackgroundTeardown(Option<std::thread::JoinHandle<()>>);

impl BackgroundTeardown {
    /// `None` on a dry run, which tears nothing down.
    fn start(stage: &Stage, instance: &Instance) -> Option<Self> {
        (!stage.is_dry_run()).then(|| {
            let instance = instance.clone();
            Self(Some(std::thread::spawn(move || {
                teardown_commands(&instance)
            })))
        })
    }

    /// Wait for what's left of the teardown, shown as a step.
    fn finish(mut self, stage: &Stage) -> Result<()> {
        let handle = self.0.take();
        stage.run_step("Tearing down previous stack", move || {
            if let Some(handle) = handle {
                let _ = handle.join();
            }
            Ok(())
        })
    }
}

impl Drop for BackgroundTeardown {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            let _ = handle.join();
        }
    }
}

/// Create the per-instance external networks and volumes the compose files
/// reference (idempotent — replaces the old `just create_networks`).
fn ensure_external_resources(stage: &Stage, instance: &Instance) -> Result<()> {
    let networks = instance.networks();
    let volumes = instance_volumes(instance);
    stage.run_step("Ensuring networks & volumes", || {
        for (name, subnet) in &networks {
            docker::ensure_network(name, subnet.as_deref())?;
        }
        for v in &volumes {
            docker::ensure_volume(v)?;
        }
        Ok(())
    })
}

/// Poll LocalStack until it answers, or until `compose_done` says compose's
/// own wait has finished and one last look still finds it down.
fn wait_localstack(url: &str, compose_done: &std::sync::mpsc::Receiver<()>) -> Result<()> {
    let answers = || {
        Command::new("curl")
            .args(["-fsS", "--max-time", "3", "-o", "/dev/null"])
            .arg(url)
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    };
    loop {
        if answers() {
            return Ok(());
        }
        match compose_done.recv_timeout(std::time::Duration::from_millis(200)) {
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                anyhow::ensure!(answers(), "LocalStack is not answering at {url}");
                return Ok(());
            }
        }
    }
}

/// `cargo x build-services`.
pub fn build_services_only() -> Result<()> {
    let stage = Stage::from_env();
    let target = arch::detect()?;
    let binaries = build::resolve(
        &stage,
        target,
        &build::BuildOptions {
            no_build: false,
            binaries_dir: None,
            only: None,
        },
    )?;
    stage.note(&format!("binaries at {}", binaries.host_dir().display()));
    Ok(())
}

/// `cargo x runtime-image`.
pub fn runtime_image_only(force: bool) -> Result<()> {
    let stage = Stage::from_env();
    build::ensure_runtime_image(&stage, arch::detect()?, force)
}

/// `cargo x gen-compose`.
pub fn gen_compose_only(args: &cli::InstanceArgs) -> Result<()> {
    let instance = Instance::resolve(args.instance.as_deref(), args.port_base)?;
    let target = arch::detect()?;
    let binaries = build::BinariesDir::TargetDir(workspace_root().join(target.debug_dir()));
    let path = gen_compose::generate(Mode::Local, &instance, &binaries, false, false)?;
    println!("{}", path.display());
    Ok(())
}

/// `cargo x stop-local` — stop the instance's containers (keep volumes).
pub fn stop(args: &cli::InstanceArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::resolve(args.instance.as_deref(), args.port_base)?;
    telemetry::RunTelemetry::action(&instance, telemetry::RunKind::Stop, || {
        supervisor::stop_processes(&instance);
        sdk_webhook::stop(&instance);
        let mut cmd = Command::new("docker");
        cmd.args(["compose", "-p", instance.project_name(), "stop"]);
        stage.run(&format!("Stopping {}", instance.project_name()), &mut cmd)
    })
}

/// `cargo x reset-local` — drop, recreate, and migrate the instance DB.
pub fn reset(args: &cli::InstanceArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::resolve(args.instance.as_deref(), args.port_base)?;
    db::reset(&stage, &instance)
}

/// `cargo x destroy-local` — remove the instance's containers, volumes, and
/// (named instances) networks, and free its allocation.
pub fn destroy(args: &cli::InstanceArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::resolve(args.instance.as_deref(), args.port_base)?;
    supervisor::stop_processes(&instance);
    // Containers + all volumes (incl. FusionAuth's external ones, which `down -v`
    // leaves behind — the same teardown run_local does for its clean slate).
    teardown(&stage, &instance)?;
    stack::clear_state(&instance)?;
    supervisor::clear_job(&instance);
    if !stage.is_dry_run() {
        allocator::release(&instance)?;
    }
    Ok(())
}
