//! Headless stack orchestration: `cargo x stack up|update|status|expose|down`.
//!
//! The preview/agent/CI surface. Same bring-up as `run_local`, but no TTY
//! hotkey loop and no attached dev server: the frontend is a static bundle
//! served by the instance's Caddy, so a finished `up` leaves only Docker
//! containers running — nothing to babysit, and the whole product lives behind
//! the ONE proxy origin. That single origin is what `expose` publishes (a
//! Cloudflare quick tunnel), what an agent drives with a browser, and what a
//! preview deploy fronts with a real hostname.
//!
//! `up` is full-delete/full-create like `run_local` (unconditionally
//! idempotent); `update` is the `r`-hotkey as a one-shot verb (rebuild, restart
//! only what changed); `status` is machine-readable state; `down` reclaims
//! everything.

use std::io::{BufReader, Read};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result, bail};
use clap::Args;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::cli::{EnvArgs, InstanceArgs, RunArgs};
use super::instance::{Instance, Port};
use super::stage::Stage;
use super::{Mode, arch, env_layer, frontend, mailpit, proxy, snapshot, summary};

#[derive(Args, Clone, Default)]
pub struct UpArgs {
    #[command(flatten)]
    pub run: RunArgs,
    /// Stage this prebuilt frontend dist instead of building (CI artifact reuse).
    #[arg(long)]
    pub frontend_dist: Option<PathBuf>,
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
pub struct SnapshotArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// Print machine-readable JSON (key, dir, present).
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Clone, Default)]
pub struct UpdateArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    #[command(flatten)]
    pub env: EnvArgs,
    /// Also rebuild + restage the static frontend and restart the proxy.
    #[arg(long)]
    pub frontend: bool,
    /// Stage this prebuilt frontend dist instead of building (implies --frontend).
    #[arg(long)]
    pub frontend_dist: Option<PathBuf>,
    /// Rebuild the Docker-built auxiliary services (sync, websocket, lexical).
    #[arg(long)]
    pub build_aux_services: bool,
    /// Stream subprocess output and show per-step timings.
    #[arg(long, short)]
    pub verbose: bool,
}

#[derive(Args, Clone)]
pub struct ApplyArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    #[command(flatten)]
    pub env: EnvArgs,
    /// Directory containing a complete prebuilt local-service binary set.
    #[arg(long)]
    pub binaries_dir: PathBuf,
    /// Prebuilt frontend dist to stage and serve (omitting leaves it unchanged).
    #[arg(long)]
    pub frontend_dist: Option<PathBuf>,
    /// Recreate the Docker-built auxiliary services after their image tags were
    /// updated externally (the Fly hot-update path pulls them from the registry).
    #[arg(long)]
    pub recreate_aux_services: bool,
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

#[derive(Args, Clone, Default)]
pub struct ExposeArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// Leave the tunnel running in the background and return (see `--stop`).
    #[arg(long)]
    pub detach: bool,
    /// Stop a previously detached tunnel.
    #[arg(long)]
    pub stop: bool,
}

/// Durable per-instance record of what `up` brought up, so `update`/`status`
/// don't need the flags repeated. Lives in the instance artifact dir.
#[derive(Serialize, Deserialize)]
struct StackState {
    /// `local` / `dev` — mirrors [`Mode::label`].
    mode: String,
    /// `static` (Caddy serves the bundle) or `none` (`--no-frontend`).
    frontend: String,
    /// Stable directory bind-mounted into every Rust service. Prebuilt updates
    /// replace files here atomically so existing container mounts see them.
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

fn read_state(instance: &Instance) -> Option<StackState> {
    let raw = std::fs::read_to_string(state_path(instance)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// `cargo x stack up` — bring the whole stack up and return, leaving only
/// Docker containers running.
pub fn up(mode: Mode, args: &UpArgs) -> Result<()> {
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

    // Same full-delete/full-create overlap as `run_stack`: tear the previous
    // stack down in the background while the host-side build runs.
    let teardown = (!stage.is_dry_run()).then(|| {
        let instance = instance.clone();
        std::thread::spawn(move || super::teardown_commands(&instance))
    });

    let static_frontend = !args.run.no_frontend && !args.infra_only;
    let (env, target) = super::prepare(&stage, mode, &instance, &args.run, static_frontend)?;
    let configured_binaries = args
        .run
        .build
        .binaries_dir
        .clone()
        .unwrap_or_else(|| super::workspace_root().join(target.debug_dir()));
    let active_binaries = super::build::BinariesDir::classify(&configured_binaries)?
        .host_dir()
        .to_path_buf();

    // Build + stage the frontend bundle in the background: it's pure host-side
    // work, independent of Docker until the proxy container mounts the staged
    // dir — so it overlaps the teardown join and the infra bring-up, and is
    // joined just before `bring_up_app` creates that container. (Dry run:
    // synchronously, so the command preview prints in order.)
    if static_frontend && stage.is_dry_run() {
        frontend::build_static(&stage, &instance, args.frontend_dist.as_deref())?;
    }
    let fe_build = (static_frontend && !stage.is_dry_run()).then(|| {
        let instance = instance.clone();
        let prebuilt = args.frontend_dist.clone();
        std::thread::spawn(move || {
            frontend::build_static(&Stage::from_env().quiet(), &instance, prebuilt.as_deref())
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
        return Ok(());
    }
    super::bring_up_app(&stage, mode, &instance, &env)?;

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
    }

    let frontend_url = if static_frontend {
        frontend::static_url(&instance)
    } else {
        "(disabled — --no-frontend)".to_string()
    };
    summary::print(mode, &instance, &env, &frontend_url);
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
    Ok(())
}

/// `cargo x stack update` — the `r` hotkey as a one-shot verb: rebuild the
/// binaries (and optionally the frontend bundle) and restart only what changed.
pub fn update(args: &UpdateArgs) -> Result<()> {
    let stage = Stage::from_env_cli(args.verbose);
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    let Some(state) = read_state(&instance) else {
        bail!(
            "no stack state at {} — bring the stack up first (`just stack up{}`)",
            state_path(&instance).display(),
            instance_suffix(&instance)
        );
    };
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
    )?;
    let target = arch::detect()?;
    super::rebuild_and_reload(
        &stage,
        mode,
        &instance,
        &env,
        target,
        args.build_aux_services,
    )?;

    if args.frontend || args.frontend_dist.is_some() {
        if state.frontend != "static" {
            bail!(
                "this stack was brought up without a static frontend (--no-frontend); \
                 re-run `just stack up` to serve one"
            );
        }
        frontend::build_static(&stage, &instance, args.frontend_dist.as_deref())?;
        // The proxy serves the staged dir via a bind mount; restart it so Caddy
        // drops any open handles onto the replaced tree.
        let mut restart = Command::new("docker");
        restart
            .args(["restart", "-t", "0"])
            .arg(format!("{}-proxy-1", instance.project_name()));
        stage.run("Reloading proxy (frontend bundle)", &mut restart)?;
    }
    Ok(())
}

/// Apply CI-built artifacts to a running headless stack. Unlike [`update`],
/// this never invokes Cargo or Bun: it compares the supplied binaries against
/// the stable bind-mounted directory, atomically replaces only changed files,
/// and restarts only their containers. The frontend proxy is recreated (not
/// merely restarted) because replacing the staged directory changes the bind
/// mount's inode.
pub fn apply(args: &ApplyArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    let Some(state) = read_state(&instance) else {
        bail!(
            "no stack state at {} — a prebuilt update requires a running headless stack",
            state_path(&instance).display()
        );
    };
    let mode = mode_from_label(&state.mode)?;
    let destination = state.binaries_dir.as_ref().ok_or_else(|| {
        anyhow::anyhow!(
            "stack state predates prebuilt updates — perform a full stack up before applying"
        )
    })?;
    let source = super::build::BinariesDir::classify(&args.binaries_dir)?;
    source.validate(&super::inventory::local_binaries())?;

    let env = env_layer::resolve(
        mode,
        &instance,
        args.env.no_doppler,
        args.env.env_file.as_deref(),
    )?;
    let mut changed = Vec::new();
    for service in super::inventory::services_for_mode(mode) {
        if replace_binary_if_changed(source.host_dir(), destination, service.cargo_bin)? {
            changed.push(service);
        }
    }

    if args.recreate_aux_services {
        super::recreate_aux_service_containers(&stage, &instance, &env)?;
    }
    if !changed.is_empty() {
        super::reload_services(&stage, &instance, &changed)?;
    }

    if let Some(frontend_dist) = args.frontend_dist.as_deref() {
        if state.frontend != "static" {
            bail!("this stack was brought up without a static frontend");
        }
        frontend::build_static(&stage, &instance, Some(frontend_dist))?;
        let mut up = super::compose_cmd(&instance, &env);
        up.args(["up", "-d", "--force-recreate", "--no-deps", "proxy"]);
        stage.run("Recreating proxy (frontend bundle)", &mut up)?;
    }

    if mode.spec().wait_backend_before_frontend {
        frontend::wait_backend_ready(&stage, &instance)?;
    }
    if args.json {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "changed_services": changed.iter().map(|s| s.compose_name).collect::<Vec<_>>(),
                "frontend_updated": args.frontend_dist.is_some(),
                "aux_services_recreated": args.recreate_aux_services,
            }))?
        );
    }
    Ok(())
}

fn replace_binary_if_changed(
    source_dir: &Path,
    destination_dir: &Path,
    name: &str,
) -> Result<bool> {
    let source = source_dir.join(name);
    let destination = destination_dir.join(name);
    if files_equal(&source, &destination)? {
        return Ok(false);
    }
    std::fs::create_dir_all(destination_dir)
        .with_context(|| format!("creating {}", destination_dir.display()))?;
    let temporary = destination_dir.join(format!(".{name}.hot-update-{}", std::process::id()));
    let _ = std::fs::remove_file(&temporary);
    std::fs::copy(&source, &temporary).with_context(|| {
        format!(
            "copying prebuilt binary {} to {}",
            source.display(),
            temporary.display()
        )
    })?;
    std::fs::rename(&temporary, &destination).with_context(|| {
        format!(
            "atomically replacing {} with {}",
            destination.display(),
            source.display()
        )
    })?;
    Ok(true)
}

fn files_equal(left: &Path, right: &Path) -> Result<bool> {
    let left_meta = std::fs::metadata(left)
        .with_context(|| format!("reading binary metadata for {}", left.display()))?;
    let Ok(right_meta) = std::fs::metadata(right) else {
        return Ok(false);
    };
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    let mut left = BufReader::new(
        std::fs::File::open(left).with_context(|| format!("opening {}", left.display()))?,
    );
    let mut right = BufReader::new(
        std::fs::File::open(right).with_context(|| format!("opening {}", right.display()))?,
    );
    let mut left_buf = [0_u8; 64 * 1024];
    let mut right_buf = [0_u8; 64 * 1024];
    loop {
        let left_read = left.read(&mut left_buf)?;
        let right_read = right.read(&mut right_buf)?;
        if left_read != right_read || left_buf[..left_read] != right_buf[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
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
    let expose = read_expose(&instance);

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
        out["expose_url"] = json!(expose.as_ref().map(|e| e.url.clone()));
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
        if let Some(e) = expose {
            println!("  exposed   {}", e.url);
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
/// tunnel, and state. `--keep-data` only stops containers.
pub fn down(args: &DownArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    if let Some(expose) = read_expose(&instance) {
        stop_tunnel(&stage, &instance, &expose);
    }
    if args.keep_data {
        return super::stop(&args.instance);
    }
    super::destroy(&args.instance)?;
    let _ = std::fs::remove_file(state_path(&instance));
    Ok(())
}

/// Where a detached tunnel's identity lives (URL + cloudflared pid).
fn expose_path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("expose.json")
}

#[derive(Serialize, Deserialize)]
struct ExposeState {
    url: String,
    pid: u32,
}

/// A recorded tunnel whose process is still alive. A stale record (machine
/// rebooted, cloudflared died) reads as "not exposed".
fn read_expose(instance: &Instance) -> Option<ExposeState> {
    let raw = std::fs::read_to_string(expose_path(instance)).ok()?;
    let state: ExposeState = serde_json::from_str(&raw).ok()?;
    // SAFETY: signal 0 only probes liveness/permission; no signal is delivered.
    let alive = unsafe { libc::kill(state.pid as i32, 0) } == 0;
    alive.then_some(state)
}

fn stop_tunnel(stage: &Stage, instance: &Instance, expose: &ExposeState) {
    // SAFETY: plain kill(2) of the recorded cloudflared pid; ESRCH is harmless.
    unsafe {
        libc::kill(expose.pid as i32, libc::SIGTERM);
    }
    let _ = std::fs::remove_file(expose_path(instance));
    stage.note(&format!(
        "stopped tunnel {} (pid {})",
        expose.url, expose.pid
    ));
}

/// `cargo x stack expose` — publish the instance's single origin through a
/// Cloudflare quick tunnel. Attached by default (Ctrl-C stops it); `--detach`
/// records the URL + pid and returns.
pub fn expose(args: &ExposeArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;

    if args.stop {
        match read_expose(&instance) {
            Some(state) => stop_tunnel(&stage, &instance, &state),
            None => stage.note("no running tunnel for this instance"),
        }
        return Ok(());
    }
    if let Some(existing) = read_expose(&instance) {
        println!("{}", existing.url);
        stage.note(&format!(
            "already exposed (pid {}) — `just stack expose --stop{}` to stop",
            existing.pid,
            instance_suffix(&instance)
        ));
        return Ok(());
    }

    let port = instance.port(Port::Proxy);
    if std::net::TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        std::time::Duration::from_millis(500),
    )
    .is_err()
    {
        bail!(
            "nothing listening on the proxy port {port} — bring the stack up first \
             (`just stack up{}`)",
            instance_suffix(&instance)
        );
    }
    if which("cloudflared").is_none() {
        bail!(
            "cloudflared not found on PATH — install it (macOS: `brew install cloudflared`; \
             nix: `nix run nixpkgs#cloudflared`) and retry"
        );
    }

    // Quick tunnel: no account, no DNS — cloudflared prints a random
    // *.trycloudflare.com hostname on stderr. Output goes to a log file so a
    // detached tunnel stays diagnosable.
    instance.ensure_artifact_dir()?;
    let log_path = instance.artifact_dir().join("expose.log");
    let log = std::fs::File::create(&log_path)
        .with_context(|| format!("creating {}", log_path.display()))?;
    let mut cmd = Command::new("cloudflared");
    cmd.args(["tunnel", "--no-autoupdate", "--url"])
        .arg(format!("http://localhost:{port}"))
        .stdin(Stdio::null())
        .stdout(log.try_clone().context("cloning log handle")?)
        .stderr(log);
    if args.detach {
        // Own process group: a later Ctrl-C in the launching shell must not
        // take the detached tunnel down with it.
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().context("launching cloudflared")?;

    // The URL appears within a few seconds; poll the log rather than the pipes
    // so attached and detached spawn identically.
    let url = 'url: {
        for _ in 0..60 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if let Some(status) = child.try_wait()? {
                let tail = std::fs::read_to_string(&log_path).unwrap_or_default();
                bail!("cloudflared exited during startup ({status})\n{tail}");
            }
            let log = std::fs::read_to_string(&log_path).unwrap_or_default();
            if let Some(url) = find_trycloudflare_url(&log) {
                break 'url url;
            }
        }
        let _ = child.kill();
        bail!(
            "cloudflared did not print a tunnel URL — see {}",
            log_path.display()
        );
    };

    println!("{url}");
    stage.note(
        "  WARNING: this URL is public and unauthenticated — anyone who has it reaches \
         this stack. Share deliberately; stop the tunnel when done.",
    );
    if args.detach {
        std::fs::write(
            expose_path(&instance),
            serde_json::to_string_pretty(&ExposeState {
                url: url.clone(),
                pid: child.id(),
            })?,
        )
        .with_context(|| format!("writing {}", expose_path(&instance).display()))?;
        stage.note(&format!(
            "  detached (pid {}) — `just stack expose --stop{}` to stop",
            child.id(),
            instance_suffix(&instance)
        ));
        return Ok(());
    }
    stage.note("  attached — Ctrl-C to stop the tunnel");
    let status = child.wait()?;
    if !status.success() {
        // Ctrl-C lands here too (SIGINT reaches the whole foreground group) —
        // only a genuinely failed tunnel should error.
        if !matches!(status.signal(), Some(libc::SIGINT | libc::SIGTERM)) {
            let tail = std::fs::read_to_string(&log_path).unwrap_or_default();
            bail!("cloudflared exited with {status}\n{tail}");
        }
    }
    Ok(())
}

/// `cargo x stack snapshot` — report the instance's init-snapshot key and
/// whether a snapshot exists for it. CI uses `--json` to find the directory to
/// bake into preview images.
pub fn snapshot_status(args: &SnapshotArgs) -> Result<()> {
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    // The key hashes the generated kickstart; (re)write it so the verb works
    // before any `up` has run. Deterministic, so this never changes a key.
    super::fusionauth::write_kickstart(&instance)?;
    let plan = snapshot::Plan::compute(&instance)?;
    if args.json {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "key": plan.key,
                "dir": plan.dir,
                "present": plan.exists(),
                "root": snapshot::root_dir(),
            }))?
        );
        return Ok(());
    }
    println!("key      {}", plan.key);
    println!("dir      {}", plan.dir.display());
    println!(
        "present  {}",
        if plan.exists() {
            "yes"
        } else {
            "no (next cold `stack up` will save it)"
        }
    );
    Ok(())
}

/// The machine-readable endpoint block `up --json` and `status --json` share.
fn summary_json(mode: Mode, instance: &Instance, static_frontend: bool) -> serde_json::Value {
    json!({
        "instance": instance.name(),
        "project": instance.project_name(),
        "mode": mode.label(),
        "proxy_url": proxy::url(instance),
        "frontend_url": static_frontend.then(|| frontend::static_url(instance)),
        "fusionauth_url": format!("http://localhost:{}", instance.port(Port::FusionAuth)),
        "mailpit_url": mailpit::ui_url(instance),
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

fn which(bin: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|p| p.join(bin))
        .find(|p| p.is_file())
}

/// Extract the quick-tunnel hostname from cloudflared's startup banner.
fn find_trycloudflare_url(text: &str) -> Option<String> {
    let end = text.find(".trycloudflare.com")? + ".trycloudflare.com".len();
    let start = text[..end].rfind("https://")?;
    Some(text[start..end].to_string())
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
