//! xtask-owned local & dev orchestration.
//!
//! `just run_local`, `just run_dev`, and the supporting
//! `doctor`/`validate`/`status`/`stop`/`reset`/`destroy` recipes all delegate here.
//! This module owns: building Linux service binaries on the host (zigbuild),
//! the minimal runtime image, the typed service inventory, per-instance
//! isolation, environment layering, generated docker-compose overrides, local
//! infra (FusionAuth via kickstart, Mailpit, LocalStack, Postgres/Redis, DB
//! migrate), the single-origin reverse proxy, and the frontend dev server.
//!
//! Design invariant: Docker never compiles Rust. Binaries are built on the host
//! and bind-mounted read-only into the runtime image at `/app/out`.

use std::path::PathBuf;

pub mod arch;
pub mod build;
pub mod cf_tunnel;
pub mod cli;
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
pub mod status;
pub mod summary;
pub mod validate;

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

/// Bring up a Local or Dev stack and (unless `--no-frontend`) the frontend.
pub fn run_stack(mode: Mode, args: &cli::RunArgs) -> Result<()> {
    if mode.spec().runs_local_infra {
        // This mode will provision Kafka topics mid-bring-up; reject a build
        // that can't do that before any containers start.
        kafka::ensure_available(&format!("run-{}", mode.label()))?;
    }
    let stage = Stage::from_env_cli(args.verbose);
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    stage.section(&format!(
        "macro {} stack — instance {}",
        mode.label(),
        instance.name()
    ));
    if !stage.is_dry_run() {
        stack::clear_state(&instance)?;
    }

    // Before `prepare` (which resolves env and reads the OTLP port to decide
    // whether to wire `OTEL_EXPORTER_OTLP_ENDPOINT`), so a `--traces` run gets
    // the same auto-wiring as a collector started manually beforehand.
    if let Some(backend) = args.traces {
        ensure_tracing_backend(&stage, backend)?;
    }

    // `run_local`/`run_dev` are full delete + full create: tear the previous
    // stack and ALL its stateful volumes down so the bring-up is always from a
    // clean slate. That makes the command unconditionally idempotent — no
    // persisted state (a stale FusionAuth DB, an old migration) can poison a
    // later run. (Unclean exits skip the quit-time teardown, so this is also the
    // idempotency safety net.) Run it in the BACKGROUND: tearing the old stack
    // down is independent of the host-side build, so the two overlap instead of
    // summing (stopping ~20 containers is otherwise the slow part of a re-run).
    let teardown = (!stage.is_dry_run()).then(|| {
        let instance = instance.clone();
        std::thread::spawn(move || teardown_commands(&instance))
    });

    // Sharing posture (`--with-cf-tunnel`, local only): besides the tunnels,
    // the proxy additionally serves the headless static bundle, because that
    // bundle — built against the `same-origin` sentinel — is the only frontend
    // a remote visitor can actually use: the dev server's bundle calls the
    // backend on an absolute `localhost:<proxy>` origin. The dev server still
    // runs for the local developer. What a visitor can't do: follow
    // backend-generated absolute links (invite/login emails point at
    // `localhost:{FRONTEND_PORT}`) or the FusionAuth OAuth flow — passwordless
    // login works, with the code readable at `<tunnel>/mailpit`.
    let share_app = args.with_cf_tunnel && mode == Mode::Local;
    if args.with_cf_tunnel && mode != Mode::Local {
        stage.note("--with-cf-tunnel is ignored by run_dev (tunnels share a fully local stack)");
    }

    // The Cursor egress tunnel, before env resolution because the minted
    // hostname is written into `EGRESS_BASE_URL`. Best-effort with a loud
    // downgrade: a laptop with no route to Cloudflare should still get a
    // working stack, minus the one thing that needs public ingress -
    // `@cursor` sessions reaching local MCP servers.
    let egress_tunnel = (share_app && !stage.is_dry_run())
        .then(|| {
            match cf_tunnel::open(&instance, "egress", instance.port(Port::AgentHarnessEgress)) {
                Ok(tunnel) => {
                    stage.note(&format!("cursor egress tunnel: {}", tunnel.url));
                    Some(tunnel)
                }
                Err(error) => {
                    stage.note(&format!(
                        "WARNING: no cursor egress tunnel ({error:#}); EGRESS_BASE_URL stays \
                         in-network, so @cursor sessions cannot reach this stack's MCP servers"
                    ));
                    None
                }
            }
        })
        .flatten();

    // The app tunnel does not feed the env, but it degrades the same way: a
    // failure warns and the stack comes up localhost-only.
    let app_tunnel = (share_app && !stage.is_dry_run())
        .then(
            || match cf_tunnel::open(&instance, "app", instance.port(Port::Proxy)) {
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
    let (env, target) = prepare(
        &stage,
        mode,
        &instance,
        args,
        share_app,
        false,
        false,
        egress_tunnel.as_ref().map(|tunnel| tunnel.url.as_str()),
    )?;

    // Build + stage the shareable bundle in the background (pure host-side
    // work), joined just before `bring_up_app` creates the proxy container
    // that mounts the staged dir. The bundle is a share-time snapshot: the
    // `r` hotkey reloads service binaries, not this bundle — live frontend
    // edits show on the dev server, not on the shared URL.
    if share_app && stage.is_dry_run() {
        frontend::build_static(&stage, &instance, mode)?;
    }
    let fe_build = (share_app && !stage.is_dry_run()).then(|| {
        let instance = instance.clone();
        std::thread::spawn(move || {
            frontend::build_static(&Stage::from_env().quiet(), &instance, mode)
        })
    });

    // Join the background teardown before we (re)create volumes + bring infra up,
    // surfaced as a live spinner so it's clear what we're blocked on. It
    // overlapped the build above, so this is just whatever's left of stopping the
    // old containers — instant if it already finished.
    if let Some(handle) = teardown {
        stage.run_step("Tearing down previous stack", move || {
            let _ = handle.join();
            Ok(())
        })?;
    }
    // Both modes run at least Redis + LocalStack locally, and those reference the
    // instance's `external` volumes/networks — which must exist before compose
    // `up`. Unconditional + idempotent, mirroring the unconditional teardown (dev
    // was tearing `macro_redis_data` down each run but never recreating it).
    ensure_external_resources(&stage, &instance)?;

    // Bring the backend infra up and fully ready — DB created + migrated,
    // LocalStack provisioned, FusionAuth kickstarted — BEFORE the app services
    // start. The teardown means everything is freshly created each run, so
    // otherwise the services race their backends on startup (no `macrodb`,
    // DynamoDB/OpenSearch connection refused).
    bring_up_infra(&stage, mode, &instance, &env, InfraInit::Full)?;
    if let Some(handle) = fe_build {
        stage.run_step("Building frontend (static bundle)", move || {
            handle
                .join()
                .map_err(|_| anyhow::anyhow!("frontend build panicked"))?
        })?;
    }
    bring_up_app(&stage, mode, &instance, &env)?;
    let _sdk_webhook_tunnel = (mode == Mode::Local && !stage.is_dry_run())
        .then(|| sdk_webhook::start(&instance))
        .transpose()?;

    // No restart-to-reload step: the teardown means `up` always creates fresh
    // containers, which start on the just-built binaries bind-mounted at
    // `/app/out`. (Reloading binaries into an already-running stack is the `r`
    // hotkey's job — see `restart_services`.)

    // Start the frontend (readiness-gated, output suppressed) BEFORE the
    // summary so the summary is the last thing printed; then block on the dev
    // server so `just run_local` stays attached (Ctrl-C stops it while the
    // backend containers keep running).
    let frontend = if args.no_frontend {
        stage.note("frontend disabled (--no-frontend)");
        None
    } else {
        frontend::start(
            &stage,
            &instance,
            mode,
            args.traces.is_some(),
            args.enable_onboarding,
        )?
    };

    // Sharing moves the Mailpit UI under `/mailpit` (MP_WEBROOT, so a remote
    // visitor can read their login code through the proxy); show the URL that
    // actually resolves.
    let mailpit_url = if share_app {
        mailpit::proxy_ui_url(&instance)
    } else {
        mailpit::direct_ui_url(&instance)
    };
    let shared_app_url = app_tunnel
        .as_ref()
        .map(|tunnel| format!("{}/app/", tunnel.url));
    summary::print(
        mode,
        &instance,
        &env,
        &frontend::url(&instance),
        &mailpit_url,
        shared_app_url.as_deref(),
    );

    match frontend {
        // Interactive terminal: stay attached with a hotkey loop.
        Some(mut fe) if stage.is_tty() => {
            interact(
                &stage,
                mode,
                &instance,
                &env,
                target,
                args.build.build_aux_services,
                &mut fe,
            )?;
        }
        // Non-interactive (piped/CI): just hold the dev server until it exits.
        Some(mut fe) => {
            let status = fe.child.wait()?;
            if !status.success() {
                let out = fe.tail_output(40);
                if !out.trim().is_empty() {
                    eprintln!("{out}");
                }
                anyhow::bail!("frontend dev server exited with {status}");
            }
        }
        None => {}
    }
    Ok(())
}

/// Print the hotkey legend shown while attached to a running stack.
fn print_hotkeys(stage: &Stage) {
    stage.note("  [r] rebuild & reload services   [q] quit (tears the stack down)");
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
) -> Result<()> {
    if stage.is_verbose() {
        // Run each step on the parent stage so the build (per group) and the
        // reload each show their own `Done <elapsed>` — the build-vs-reload
        // split — rather than folding into one line.
        run_rebuild(stage, mode, instance, env, target, build_aux_services)
    } else {
        stage.run_step("Rebuilding & reloading services", || {
            run_rebuild(
                &stage.quiet(),
                mode,
                instance,
                env,
                target,
                build_aux_services,
            )
        })
    }
}

/// Snapshot binary mtimes, rebuild, and restart only the services whose binary
/// the build rewrote. Runs on a quiet sub-stage when folded, or the parent stage
/// under `--verbose` so each step times itself.
fn run_rebuild(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    target: arch::Target,
    build_aux_services: bool,
) -> Result<()> {
    let before: Vec<Option<std::time::SystemTime>> = inventory::services_for_mode(mode)
        .map(|svc| binary_mtime(target, svc))
        .collect();
    if build_aux_services {
        std::thread::scope(|scope| {
            let rust_build = scope.spawn(|| {
                build::resolve(
                    stage,
                    target,
                    &build::BuildOptions {
                        no_build: false,
                        binaries_dir: None,
                    },
                )
            });
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
        build::resolve(
            stage,
            target,
            &build::BuildOptions {
                no_build: false,
                binaries_dir: None,
            },
        )?;
    }
    let changed: Vec<&inventory::RustService> = inventory::services_for_mode(mode)
        .zip(before)
        .filter(|(svc, was)| binary_mtime(target, svc) != *was)
        .map(|(svc, _)| svc)
        .collect();
    if build_aux_services {
        recreate_aux_service_containers(stage, instance, env)?;
    }
    if !changed.is_empty() {
        reload_services(stage, instance, &changed)?;
    }
    Ok(())
}

/// Modification time of a service's built binary (`None` if absent). Used to tell
/// which binaries a rebuild rewrote.
fn binary_mtime(
    target: arch::Target,
    svc: &inventory::RustService,
) -> Option<std::time::SystemTime> {
    let path = workspace_root()
        .join(target.debug_dir())
        .join(svc.cargo_bin);
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Stay attached to the running stack, handling hotkeys until the user quits or
/// the frontend exits. `r` rebuilds + reloads the services; `q`/Esc/Ctrl-C stops
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
        if let Some(status) = fe.child.try_wait()? {
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
                let _ = rebuild_and_reload(stage, mode, instance, env, target, build_aux_services);
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
/// app bundle (headless `stack up`, and `run_local --with-cf-tunnel`'s shared
/// app). `infra_only` skips zigbuild: bake never
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
    egress_public_url: Option<&str>,
) -> Result<(env_layer::ResolvedEnv, arch::Target)> {
    let env = env_layer::resolve(
        mode,
        instance,
        args.env.no_doppler,
        args.env.env_file.as_deref(),
        static_frontend,
        egress_public_url,
    )?;
    stage.note(&format!("env: {}", env_layer::summarize(&env.merged)));
    sandbox_image::ensure(stage, &env.merged, args.build.no_build)?;

    // Build the runtime image (idempotent) and the service binaries.
    let target = arch::detect()?;
    build::ensure_runtime_image(stage, target, false)?;
    let binaries = if infra_only {
        // Compose still emits `/app/out` mounts, but infra-only never starts
        // those services. Bake runs this in parallel with zigbuild.
        build::BinariesDir::TargetDir(workspace_root().join(target.debug_dir()))
    } else {
        build::resolve(
            stage,
            target,
            &build::BuildOptions {
                no_build: args.build.no_build,
                binaries_dir: args.build.binaries_dir.clone(),
            },
        )?
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
    let mut up = compose_cmd(instance, env);
    up.arg("up").arg("-d").arg("--wait").args(waited);
    stage.run("Starting infra (docker compose up -d --wait)", &mut up)?;

    // LocalStack has no healthcheck: poll its API, then provision S3/SQS/DynamoDB.
    let localstack_health = format!(
        "http://localhost:{}/_localstack/health",
        instance.port(Port::LocalStack)
    );
    wait_http(stage, "Waiting for LocalStack", &localstack_health)?;
    stage.run_step("Provisioning LocalStack", || {
        localstack::provision(instance)
    })?;

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

        // Start FusionAuth on its own (impatient healthcheck → no `--wait`) and
        // poll it patiently until it's up. On a full init that wait covers the
        // ~minute kickstart; on a snapshot restore the kickstart is already in
        // the restored volumes, so this is just JVM boot.
        let mut fa = compose_cmd(instance, env);
        fa.arg("up").arg("-d").arg("fusionauth");
        stage.run("Starting FusionAuth", &mut fa)?;
        fusionauth::wait_ready(stage, instance)?;

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
    // A keyed backend with a missing key accepts telemetry locally and drops
    // every payload at the vendor intake (403), which looks like "traces are
    // broken" rather than "key is missing" — so fail loud up front.
    if let Some(var) = backend.required_env()
        && macro_env_var::maybe_read_env(var).is_none_or(|v| v.is_empty())
    {
        anyhow::bail!(
            "--traces {} requires the {var} env var to be set (export it in \
             the shell you run this from)",
            backend.compose_profile()
        );
    }
    let compose = repo_root().join("docker/docker-compose.yml");
    let mut up = Command::new("docker");
    up.arg("compose")
        .arg("--project-directory")
        .arg(repo_root())
        .arg("-f")
        .arg(&compose)
        .arg("--profile")
        .arg(backend.compose_profile())
        .arg("up")
        .arg("-d")
        .arg("--remove-orphans")
        .arg(backend.compose_service());
    stage.run(
        &format!("Starting {} trace collector", backend.compose_profile()),
        &mut up,
    )?;

    // `up -d` returns once the container starts, not once it's accepting
    // connections; `env_layer::resolve` (which runs right after this, in
    // `prepare`) needs the OTLP port live NOW to decide whether to wire
    // `OTEL_EXPORTER_OTLP_ENDPOINT`, so wait for it here instead of racing.
    for _ in 0..50 {
        if summary::port_open(4318) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    anyhow::bail!(
        "{} trace collector did not come up on port 4318 in time",
        backend.compose_profile()
    )
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
        .arg(format!("{}_services", instance.project_name()))
        .arg(collector)
        .output();
}

/// Restart the given services' containers so they re-exec their freshly built
/// binaries (bind-mounted at `/app/out`). Uses plain `docker restart -t 0` by
/// container name — no `docker compose` config parse, no graceful-stop grace,
/// and only the changed containers — so a reload after a small change is ~1s
/// rather than bouncing all twelve. Restarting only the changed subset also
/// avoids the `depends_on` race a full restart hits (a service coming back
/// before a peer it depends on).
fn reload_services(
    stage: &Stage,
    instance: &Instance,
    services: &[&inventory::RustService],
) -> Result<()> {
    if stage.is_dry_run() {
        return Ok(());
    }
    let mut cmd = Command::new("docker");
    cmd.arg("restart").arg("-t").arg("0");
    for svc in services {
        // Compose names containers `<project>-<service>-1`.
        cmd.arg(format!(
            "{}-{}-1",
            instance.project_name(),
            svc.compose_name
        ));
    }
    let names = services
        .iter()
        .map(|s| s.compose_name)
        .collect::<Vec<_>>()
        .join(", ");
    stage.run(&format!("Reloading {names}"), &mut cmd)
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

/// The instance's external Docker networks.
fn instance_networks(instance: &Instance) -> [String; 2] {
    [instance.network_databases(), instance.network_auth()]
}

/// The docker teardown work: stop + remove the instance's stack and ALL its
/// stateful volumes — the basis of `run_local`'s full-delete/full-create
/// idempotency, the quit hotkey, and `destroy-local`. Containers + project
/// networks come down with `down -v`; the data volumes are then removed
/// explicitly, because FusionAuth's (and named instances' infra) volumes are
/// declared `external`, which `down -v` leaves behind. Output is captured (this
/// is best-effort and noisy) so callers surface it as a single line; absent
/// containers/volumes are ignored.
fn teardown_commands(instance: &Instance) {
    sdk_webhook::stop(instance);
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

/// Create the per-instance external networks and volumes the compose files
/// reference (idempotent — replaces the old `just create_networks`).
fn ensure_external_resources(stage: &Stage, instance: &Instance) -> Result<()> {
    let networks = instance_networks(instance);
    let volumes = instance_volumes(instance);
    stage.run_step("Ensuring networks & volumes", || {
        for n in &networks {
            docker::ensure_network(n)?;
        }
        for v in &volumes {
            docker::ensure_volume(v)?;
        }
        Ok(())
    })
}

fn wait_http(stage: &Stage, label: &str, url: &str) -> Result<()> {
    let script = format!(
        "for i in $(seq 1 60); do curl -fsS --max-time 3 {url} >/dev/null 2>&1 && exit 0; sleep 2; done; echo 'not ready: {url}'; exit 1"
    );
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(script);
    stage.run(label, &mut cmd)
}

/// `cargo x zigbuild`.
pub fn zigbuild_only() -> Result<()> {
    let stage = Stage::from_env();
    let target = arch::detect()?;
    let binaries = build::resolve(
        &stage,
        target,
        &build::BuildOptions {
            no_build: false,
            binaries_dir: None,
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
    let instance = Instance::derive(args.instance.as_deref(), args.port_base)?;
    let target = arch::detect()?;
    let binaries = build::BinariesDir::TargetDir(workspace_root().join(target.debug_dir()));
    let path = gen_compose::generate(Mode::Local, &instance, &binaries, false, false)?;
    println!("{}", path.display());
    Ok(())
}

/// `cargo x stop-local` — stop the instance's containers (keep volumes).
pub fn stop(args: &cli::InstanceArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::derive(args.instance.as_deref(), args.port_base)?;
    sdk_webhook::stop(&instance);
    let mut cmd = Command::new("docker");
    cmd.args(["compose", "-p", instance.project_name(), "stop"]);
    stage.run(&format!("Stopping {}", instance.project_name()), &mut cmd)
}

/// `cargo x reset-local` — drop, recreate, and migrate the instance DB.
pub fn reset(args: &cli::InstanceArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::derive(args.instance.as_deref(), args.port_base)?;
    db::reset(&stage, &instance)
}

/// `cargo x destroy-local` — remove the instance's containers, volumes, and
/// (named instances) external networks.
pub fn destroy(args: &cli::InstanceArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::derive(args.instance.as_deref(), args.port_base)?;
    // Containers + all volumes (incl. FusionAuth's external ones, which `down -v`
    // leaves behind — the same teardown run_local does for its clean slate).
    teardown(&stage, &instance)?;
    // The per-instance external networks only exist for named instances; the
    // default instance's are shared base-compose networks we leave in place.
    if !instance.is_default() {
        stage.run_step("Removing instance networks", || {
            for n in instance_networks(&instance) {
                let _ = Command::new("docker").args(["network", "rm", &n]).status();
            }
            Ok(())
        })?;
    }
    Ok(())
}
