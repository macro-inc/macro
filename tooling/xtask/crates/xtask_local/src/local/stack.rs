//! Headless stack orchestration: `cargo x stack up|update|status|down`.
//!
//! Same bring-up as `run_local`, but no TTY hotkey loop and no attached dev
//! server. The frontend is a static bundle served by Caddy. A finished `up`
//! leaves only Docker containers running behind one proxy origin.
//!
//! `up` is full-delete/full-create. `update` adopts a new binary directory
//! without touching volumes. If nothing is recorded yet, `update` bootstraps
//! through `up`. `status` is machine-readable state. `down` reclaims everything.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result, bail};
use clap::Args;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::cli::{EnvArgs, InstanceArgs, RunArgs};
use super::instance::{Instance, Port};
use super::stage::Stage;
use super::{Mode, arch, env_layer, frontend, mailpit, proxy, sdk_webhook, snapshot, summary};

#[derive(Args, Clone, Default)]
pub struct UpArgs {
    #[command(flatten)]
    pub run: RunArgs,
    /// Neither restore from nor save an init snapshot — always run the full
    /// migrate/kickstart/index init.
    #[arg(long)]
    pub no_snapshot: bool,
    /// Stop after the infra bring-up + init (and the snapshot save/restore):
    /// no app services, proxy, or frontend. This is the CI bake mode — the
    /// app services need the Doppler-sourced env (AWS endpoints, shared
    /// secrets) to even boot, which a bake environment deliberately lacks,
    /// and the init snapshot only captures the infra volumes anyway.
    #[arg(long)]
    pub infra_only: bool,
    /// Print a machine-readable JSON summary as the final line.
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Clone, Default)]
pub struct UpdateArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    #[command(flatten)]
    pub env: EnvArgs,
    /// Also rebuild + restage the static frontend and recreate the proxy.
    #[arg(long)]
    pub frontend: bool,
    /// Adopt this complete prebuilt binary set instead of invoking Cargo.
    #[arg(long)]
    pub binaries_dir: Option<PathBuf>,
    /// Rebuild every repository-built local Docker service and recreate it.
    #[arg(long)]
    pub build_aux_services: bool,
    /// Stream subprocess output and show per-step timings.
    #[arg(long, short)]
    pub verbose: bool,
    /// Print a machine-readable summary as the final line.
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Clone, Default)]
pub struct StatusArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// Print machine-readable JSON instead of the human summary.
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Clone, Default)]
pub struct DownArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// Stop containers but keep volumes (data survives the next `stack up`...
    /// which wipes them anyway — use `just run_local`/`stop_local` semantics).
    #[arg(long)]
    pub keep_data: bool,
}

/// Durable per-instance record of what `up` brought up, so `update`/`status`
/// don't need the flags repeated. Lives in the instance artifact dir.
#[derive(Serialize, Deserialize)]
struct StackState {
    /// `local` / `dev` — mirrors [`Mode::label`].
    mode: String,
    /// `static` (Caddy serves the bundle) or `none` (`--no-frontend`).
    frontend: String,
    /// Host directory currently bind-mounted at `/app/out`.
    #[serde(default)]
    binaries_dir: Option<PathBuf>,
}

fn state_path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("stack.json")
}

fn write_state(instance: &Instance, state: &StackState) -> Result<()> {
    instance.ensure_artifact_dir()?;
    let path = state_path(instance);
    std::fs::write(&path, serde_json::to_string_pretty(state)?)
        .with_context(|| format!("writing {}", path.display()))
}

/// Whether the recorded stack serves the frontend as the static bundle on the
/// proxy (headless `stack up`) rather than the dev server. False when no
/// stack state exists (interactive `run_local`, which owns the dev server).
pub(super) fn frontend_is_static(instance: &Instance) -> bool {
    read_state(instance).is_some_and(|state| state.frontend == "static")
}

fn read_state(instance: &Instance) -> Option<StackState> {
    let raw = std::fs::read_to_string(state_path(instance)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Invalidate headless ownership before another flow replaces this instance.
/// State is written again only after a full headless stack passes its health
/// gate, so failed, infra-only, and interactive replacements cannot inherit it.
pub(super) fn clear_state(instance: &Instance) -> Result<()> {
    let path = state_path(instance);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).with_context(|| format!("removing {}", path.display())),
    }
}

/// `cargo x stack up` — bring the whole stack up and return, leaving only
/// Docker containers running.
pub fn up(mode: Mode, args: &UpArgs) -> Result<Instance> {
    let stage = Stage::from_env_cli(args.run.verbose);
    let instance = Instance::derive(
        args.run.instance.instance.as_deref(),
        args.run.instance.port_base,
    )?;
    stage.section(&format!(
        "macro {} stack (headless) — instance {}",
        mode.label(),
        instance.name()
    ));
    if !stage.is_dry_run() {
        clear_state(&instance)?;
    }

    // Same full-delete/full-create overlap as `run_stack`: tear the previous
    // stack down in the background while the host-side build runs.
    let teardown = (!stage.is_dry_run()).then(|| {
        let instance = instance.clone();
        std::thread::spawn(move || super::teardown_commands(&instance))
    });

    let static_frontend = !args.run.no_frontend && !args.infra_only;
    let infra_only = args.infra_only;
    let (env, target) = super::prepare(
        &stage,
        mode,
        &instance,
        &args.run,
        static_frontend,
        infra_only,
        infra_only,
        // Headless stacks serve agents on Cursor Cloud dev boxes, which have
        // no cloudflared and no @cursor sessions to feed; the egress stays
        // in-network.
        None,
    )?;

    // Build + stage the frontend bundle in the background: it's pure host-side
    // work, independent of Docker until the proxy container mounts the staged
    // dir — so it overlaps the teardown join and the infra bring-up, and is
    // joined just before `bring_up_app` creates that container. (Dry run:
    // synchronously, so the command preview prints in order.)
    if static_frontend && stage.is_dry_run() {
        frontend::build_static(&stage, &instance, mode)?;
    }
    let fe_build = (static_frontend && !stage.is_dry_run()).then(|| {
        let instance = instance.clone();
        std::thread::spawn(move || {
            frontend::build_static(&Stage::from_env().quiet(), &instance, mode)
        })
    });

    // The init snapshot decision: hash the init-defining inputs (possible only
    // after `prepare` wrote the kickstart) and check for a stored snapshot.
    // Restores skip migrate/kickstart/index-init; a cold init saves one for
    // next time — that's how the cache seeds itself.
    let snapshot_plan = (!args.no_snapshot && !stage.is_dry_run())
        .then(|| snapshot::Plan::compute(&instance))
        .transpose()?;

    if let Some(handle) = teardown {
        stage.run_step("Tearing down previous stack", move || {
            let _ = handle.join();
            Ok(())
        })?;
    }
    super::ensure_external_resources(&stage, &instance)?;
    match &snapshot_plan {
        Some(plan) if plan.exists() => {
            snapshot::restore(&stage, &instance, plan)?;
            super::bring_up_infra(
                &stage,
                mode,
                &instance,
                &env,
                super::InfraInit::FromSnapshot,
            )?;
        }
        Some(plan) => {
            super::bring_up_infra(&stage, mode, &instance, &env, super::InfraInit::Full)?;
            snapshot::save(&stage, &instance, &env, plan)?;
        }
        None => {
            super::bring_up_infra(&stage, mode, &instance, &env, super::InfraInit::Full)?;
        }
    }
    if let Some(handle) = fe_build {
        stage.run_step("Building frontend (static bundle)", move || {
            handle
                .join()
                .map_err(|_| anyhow::anyhow!("frontend build panicked"))?
        })?;
    }
    if args.infra_only {
        // No app stack, no proxy: nothing to summarize or gate on, and no
        // stack.json — `update`/`status` on an infra-only bake should say
        // "bring the stack up first" rather than assume a running app.
        stage.note("  infra-only: app services, proxy, and frontend skipped");
        if args.json {
            println!(
                "{}",
                serde_json::to_string(&summary_json(mode, &instance, false))?
            );
        }
        return Ok(instance);
    }
    let configured_binaries = args
        .run
        .build
        .binaries_dir
        .clone()
        .unwrap_or_else(|| super::workspace_root().join(target.debug_dir()));
    let binaries = super::build::BinariesDir::classify(&configured_binaries)?;
    binaries.pin_gc_root(&instance.artifact_dir())?;
    let active_binaries = binaries.host_dir().to_path_buf();
    super::bring_up_app(&stage, mode, &instance, &env)?;
    let _sdk_webhook_tunnel = (mode == Mode::Local && !stage.is_dry_run())
        .then(|| sdk_webhook::start(&instance))
        .transpose()?;

    // Headless "ready" means the backend answers through the proxy — the caller
    // (a CI step, an agent) acts on the URL the moment we return.
    if mode.spec().wait_backend_before_frontend {
        frontend::wait_backend_ready(&stage, &instance)?;
    }

    if !stage.is_dry_run() {
        write_state(
            &instance,
            &StackState {
                mode: mode.label().to_string(),
                frontend: if static_frontend { "static" } else { "none" }.to_string(),
                binaries_dir: Some(active_binaries),
            },
        )?;
        super::build::BinariesDir::release_previous_gc_root(&instance.artifact_dir());
    }

    let frontend_url = if static_frontend {
        frontend::static_url(&instance)
    } else {
        "(disabled — --no-frontend)".to_string()
    };
    let mailpit_url = if static_frontend {
        mailpit::proxy_ui_url(&instance)
    } else {
        mailpit::direct_ui_url(&instance)
    };
    summary::print(mode, &instance, &env, &frontend_url, &mailpit_url, None);
    stage.note(&format!(
        "  headless: `just stack status`, `just stack update`, `just stack down`{}",
        instance_suffix(&instance)
    ));
    if args.json {
        println!(
            "{}",
            serde_json::to_string(&summary_json(mode, &instance, static_frontend))?
        );
    }
    Ok(instance)
}

/// `cargo x stack update` — adopt a new build into the running stack.
/// Volumes stay. With no recorded stack, this bootstraps through [`up`].
pub fn update(args: &UpdateArgs) -> Result<()> {
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    if read_state(&instance).is_none() {
        return bootstrap_from_update(args);
    }
    update_running(args)
}

fn bootstrap_from_update(args: &UpdateArgs) -> Result<()> {
    let up_args = UpArgs {
        run: super::cli::RunArgs {
            instance: args.instance.clone(),
            env: args.env.clone(),
            build: super::cli::BuildArgs {
                no_build: args.binaries_dir.is_some(),
                build_aux_services: args.build_aux_services,
                binaries_dir: args.binaries_dir.clone(),
            },
            no_frontend: false,
            enable_onboarding: false,
            verbose: args.verbose,
            traces: None,
            with_cf_tunnel: false,
        },
        no_snapshot: false,
        infra_only: false,
        json: args.json,
    };
    up(Mode::Local, &up_args).map(|_| ())
}

fn update_running(args: &UpdateArgs) -> Result<()> {
    let stage = Stage::from_env_cli(args.verbose);
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    let state = read_state(&instance).expect("update_running requires stack state");
    let mode = mode_from_label(&state.mode)?;
    stage.section(&format!(
        "macro {} stack update — instance {}",
        mode.label(),
        instance.name()
    ));

    let env = env_layer::resolve(
        mode,
        &instance,
        args.env.no_doppler,
        args.env.env_file.as_deref(),
        state.frontend == "static",
        None,
    )?;
    let remounted = if let Some(source) = args.binaries_dir.as_deref() {
        let new = super::build::BinariesDir::classify(source)?;
        new.validate(&super::inventory::local_binaries())?;
        new.pin_gc_root(&instance.artifact_dir())?;
        match new.adoption_from_recorded(state.binaries_dir.as_deref()) {
            super::build::Adoption::Unchanged => {
                stage.note("binaries unchanged — mounts left as-is");
                false
            }
            super::build::Adoption::Remount => {
                remount(&stage, mode, &instance, &env, &new, &state)?;
                true
            }
        }
    } else {
        let target = arch::detect()?;
        super::rebuild_and_reload(
            &stage,
            mode,
            &instance,
            &env,
            target,
            args.build_aux_services,
        )?;
        false
    };

    if args.binaries_dir.is_some() && args.build_aux_services {
        super::build_aux_service_images(&stage, &instance, &env)?;
        super::recreate_aux_service_containers(&stage, &instance, &env)?;
    }

    if args.frontend {
        reload_static_frontend(&stage, &instance, mode, &env, &state)?;
    }
    if mode.spec().wait_backend_before_frontend {
        frontend::wait_backend_ready(&stage, &instance)?;
    }
    if args.json {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "remounted": remounted,
                "frontend_updated": args.frontend,
                "aux_services_rebuilt": args.build_aux_services,
            }))?
        );
    }
    Ok(())
}

fn remount(
    stage: &Stage,
    mode: Mode,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    new: &super::build::BinariesDir,
    state: &StackState,
) -> Result<()> {
    let gmail_forwarder = env
        .merged
        .get("GMAIL_FORWARDER_SA_KEY")
        .is_some_and(|key| !key.trim().is_empty());
    super::gen_compose::generate(
        mode,
        instance,
        new,
        state.frontend == "static",
        gmail_forwarder,
    )?;
    let mut up = super::compose_cmd(instance, env);
    up.args([
        "up",
        "-d",
        "--force-recreate",
        "--no-deps",
        "--remove-orphans",
    ]);
    for svc in super::inventory::services_for_mode(mode) {
        up.arg(svc.compose_name);
    }
    if gmail_forwarder {
        up.arg("gmail_forwarder");
    }
    stage.run("Remounting Rust services", &mut up)?;
    write_state(
        instance,
        &StackState {
            mode: state.mode.clone(),
            frontend: state.frontend.clone(),
            binaries_dir: Some(new.host_dir().to_path_buf()),
        },
    )?;
    super::build::BinariesDir::release_previous_gc_root(&instance.artifact_dir());
    Ok(())
}

fn reload_static_frontend(
    stage: &Stage,
    instance: &Instance,
    mode: Mode,
    env: &env_layer::ResolvedEnv,
    state: &StackState,
) -> Result<()> {
    if state.frontend != "static" {
        bail!(
            "this stack was brought up without a static frontend (--no-frontend); \
             re-run `just stack up` to serve one"
        );
    }
    frontend::build_static(stage, instance, mode)?;
    // build_static replaces the staged directory, so the container must be
    // recreated to establish a bind mount to the new inode.
    let mut up = super::compose_cmd(instance, env);
    up.args(["up", "-d", "--force-recreate", "--no-deps", "proxy"]);
    stage.run("Recreating proxy (frontend bundle)", &mut up)
}

/// `cargo x stack status` — container states + health through the proxy, as a
/// human summary or `--json` for machines.
pub fn status(args: &StatusArgs) -> Result<()> {
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    let state = read_state(&instance);
    let services = compose_ps(&instance)?;
    let running = services.iter().any(|s| s.state == "running");
    let backend_healthy = running && probe(&format!("{}/auth/health", proxy::url(&instance)));
    let static_frontend = state.as_ref().is_some_and(|s| s.frontend == "static");
    let frontend_url = static_frontend.then(|| frontend::static_url(&instance));
    if args.json {
        let mut out = summary_json(
            state.as_ref().map_or(Mode::Local, |s| {
                mode_from_label(&s.mode).unwrap_or(Mode::Local)
            }),
            &instance,
            static_frontend,
        );
        out["running"] = json!(running);
        out["backend_healthy"] = json!(backend_healthy);
        out["services"] = json!(services);
        println!("{}", serde_json::to_string(&out)?);
        return Ok(());
    }

    println!(
        "instance {} (project {}): {}",
        instance.name(),
        instance.project_name(),
        if running { "running" } else { "not running" }
    );
    if running {
        println!(
            "  backend   {} ({})",
            proxy::url(&instance),
            if backend_healthy {
                "healthy"
            } else {
                "UNHEALTHY"
            }
        );
        if let Some(url) = frontend_url {
            println!("  frontend  {url}");
        }
    }
    for svc in &services {
        let health = svc
            .health
            .as_deref()
            .filter(|h| !h.is_empty())
            .map(|h| format!(" ({h})"))
            .unwrap_or_default();
        println!("  {:<32} {}{health}", svc.service, svc.state);
    }
    if services.is_empty() {
        println!("  (no containers)");
    }
    Ok(())
}

/// `cargo x stack down` — reclaim the instance: containers, volumes, networks,
/// and state. `--keep-data` only stops containers.
pub fn down(args: &DownArgs) -> Result<()> {
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    if args.keep_data {
        return super::stop(&args.instance);
    }
    super::destroy(&args.instance)?;
    clear_state(&instance)?;
    Ok(())
}

/// The machine-readable endpoint block `up --json` and `status --json` share.
fn summary_json(mode: Mode, instance: &Instance, static_frontend: bool) -> serde_json::Value {
    let mailpit_url = mode.spec().runs_local_infra.then(|| {
        if static_frontend {
            mailpit::proxy_ui_url(instance)
        } else {
            mailpit::direct_ui_url(instance)
        }
    });
    json!({
        "instance": instance.name(),
        "project": instance.project_name(),
        "mode": mode.label(),
        "proxy_url": proxy::url(instance),
        "frontend_url": static_frontend.then(|| frontend::static_url(instance)),
        "fusionauth_url": format!("http://localhost:{}", instance.port(Port::FusionAuth)),
        "mailpit_url": mailpit_url,
        "localstack_url": format!("http://localhost:{}", instance.port(Port::LocalStack)),
        "postgres_url": format!(
            "postgres://user:password@localhost:{}/macrodb",
            instance.port(Port::Postgres)
        ),
        "logs_cmd": format!("docker compose -p {} logs -f", instance.project_name()),
    })
}

/// One row of `docker compose ps`.
#[derive(Serialize)]
struct ServiceStatus {
    service: String,
    state: String,
    health: Option<String>,
}

/// `docker compose -p <project> ps --all --format json`, tolerant of both the
/// NDJSON (v2.21+) and JSON-array output shapes.
fn compose_ps(instance: &Instance) -> Result<Vec<ServiceStatus>> {
    let out = Command::new("docker")
        .args([
            "compose",
            "-p",
            instance.project_name(),
            "ps",
            "--all",
            "--format",
            "json",
        ])
        .output()
        .context("running `docker compose ps`")?;
    if !out.status.success() {
        bail!(
            "`docker compose ps` failed:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let values: Vec<serde_json::Value> = if text.trim_start().starts_with('[') {
        serde_json::from_str(text.trim()).context("parsing compose ps json array")?
    } else {
        text.lines()
            .filter(|l| !l.trim().is_empty())
            .map(serde_json::from_str)
            .collect::<std::result::Result<_, _>>()
            .context("parsing compose ps ndjson")?
    };
    Ok(values
        .into_iter()
        .map(|v| ServiceStatus {
            service: str_field(&v, "Service"),
            state: str_field(&v, "State"),
            health: v.get("Health").and_then(|h| h.as_str()).map(str::to_string),
        })
        .collect())
}

fn str_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|s| s.as_str())
        .unwrap_or_default()
        .to_string()
}

/// One quick `curl` probe (the tooling already leans on curl for readiness).
fn probe(url: &str) -> bool {
    Command::new("curl")
        .args(["-fsS", "-m", "3", "-o", "/dev/null", url])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn mode_from_label(label: &str) -> Result<Mode> {
    match label {
        "local" => Ok(Mode::Local),
        "dev" => Ok(Mode::Dev),
        other => bail!("unknown mode '{other}' in stack.json"),
    }
}

/// The `--instance <name>` suffix for copy-pasteable hints ("" for the default).
fn instance_suffix(instance: &Instance) -> String {
    if instance.is_default() {
        String::new()
    } else {
        format!(" --instance {}", instance.name())
    }
}

#[cfg(test)]
mod test;
