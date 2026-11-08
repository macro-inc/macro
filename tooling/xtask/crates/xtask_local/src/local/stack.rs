//! Lower-level stack control: `cargo x stack up|update|status|down`, and the state
//! every flow records.
//!
//! Same bring-up as `run_local` ([`super::bring_up`]), with a static frontend served
//! by Caddy and no background process: a finished `up` leaves only Docker containers
//! running behind one proxy origin. Cursor Cloud and environment bakes use this.
//! Everyone else should use `run_local`, which also runs without a terminal.
//!
//! `up` is full-delete/full-create. `update` adopts a new binary directory without
//! touching volumes, and only bootstraps through `up` on an instance with no data.
//! `status` is machine-readable state. `down` reclaims everything.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result, bail};
use clap::Args;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::cli::{EnvArgs, InstanceArgs, RunArgs};
use super::instance::{Instance, Port};
use super::local_env::Tunnels;
use super::stage::Stage;
use super::supervisor::{self, JobKind, JobStatus};
use super::{BringUp, Mode, Start, arch, env_layer, frontend, mailpit, proxy};

#[derive(Args, Clone, Default)]
pub struct UpArgs {
    #[command(flatten)]
    pub run: RunArgs,
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
    /// On an instance with data but no recorded stack, wipe it and start over
    /// instead of refusing.
    #[arg(long)]
    pub wipe_if_unrecorded: bool,
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
    /// Stop containers but keep volumes. `just run_local` resumes them; `stack up`
    /// wipes them.
    #[arg(long)]
    pub keep_data: bool,
}

/// Durable per-instance record of what a bring-up brought up, so later commands
/// don't need the flags repeated. Lives in the instance artifact dir. Written by
/// every flow once its backend is healthy; its absence means no stack to adopt.
#[derive(Serialize, Deserialize)]
struct StackState {
    /// `local` / `dev` — mirrors [`Mode::label`].
    mode: String,
    /// `vite` (a dev server behind the proxy), `static` (Caddy serves the bundle),
    /// or `none` (`--no-frontend`).
    frontend: String,
    /// Host directory currently bind-mounted at `/app/out`.
    #[serde(default)]
    binaries_dir: Option<PathBuf>,
    /// The proxy also serves a static bundle alongside Vite (`--with-cf-tunnel`).
    #[serde(default)]
    shares_bundle: bool,
    #[serde(default)]
    no_doppler: bool,
    #[serde(default)]
    env_file: Option<PathBuf>,
    /// The minted tunnel addresses, so regenerating the env keeps them.
    #[serde(default)]
    egress_url: Option<String>,
    #[serde(default)]
    preview_ssh_host: Option<String>,
    /// `--traces off` must survive a rebuild regenerating the env.
    #[serde(default = "traces_on")]
    traces_enabled: bool,
}

fn traces_on() -> bool {
    true
}

impl StackState {
    /// Whether the proxy serves a built bundle, which also moves Mailpit under it.
    fn serves_bundle(&self) -> bool {
        self.frontend == "static" || self.shares_bundle
    }

    fn frontend_url(&self, instance: &Instance) -> Option<String> {
        match self.frontend.as_str() {
            "vite" => frontend::https_url(instance).ok(),
            "static" => Some(frontend::static_url(instance)),
            _ => None,
        }
    }
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

/// Record a stack whose backend just passed its health gate.
pub(super) fn record(
    instance: &Instance,
    mode: Mode,
    args: &RunArgs,
    plan: &BringUp,
    binaries_dir: Option<PathBuf>,
    egress_url: Option<String>,
    preview_ssh_host: Option<String>,
) -> Result<()> {
    let frontend = if plan.vite {
        "vite"
    } else if plan.static_bundle {
        "static"
    } else {
        "none"
    };
    write_state(
        instance,
        &StackState {
            mode: mode.label().to_string(),
            frontend: frontend.to_string(),
            binaries_dir,
            shares_bundle: plan.vite && plan.static_bundle,
            no_doppler: args.env.no_doppler,
            env_file: args.env.env_file.clone(),
            egress_url,
            preview_ssh_host,
            traces_enabled: args.traces.enabled(),
        },
    )
}

pub(super) fn is_recorded(instance: &Instance) -> bool {
    read_state(instance).is_some()
}

/// Whether the recorded stack serves a headless bundle from the proxy.
pub(super) fn frontend_is_static(instance: &Instance) -> bool {
    read_state(instance).is_some_and(|state| state.frontend == "static")
}

fn read_state(instance: &Instance) -> Option<StackState> {
    let raw = std::fs::read_to_string(state_path(instance)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Invalidate the record before a flow replaces this instance. State is written
/// again only after a full stack passes its health gate, so failed and infra-only
/// replacements cannot inherit it.
pub(super) fn clear_state(instance: &Instance) -> Result<()> {
    let path = state_path(instance);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).with_context(|| format!("removing {}", path.display())),
    }
}

/// `cargo x stack up` — wipe the instance, bring the whole stack up and return,
/// leaving only Docker containers running.
pub fn up(mode: Mode, args: &UpArgs) -> Result<Instance> {
    let stage = Stage::from_env_cli(args.run.verbose);
    let mut instance = Instance::derive(
        args.run.instance.instance.as_deref(),
        args.run.instance.port_base,
    )?;
    stage.section(&format!(
        "macro {} stack (headless) — instance {}",
        mode.label(),
        instance.name()
    ));
    if !stage.is_dry_run() {
        supervisor::stop_processes(&instance);
        // A failed run_local's record would otherwise outrank this bring-up in
        // the phase.
        supervisor::clear_job(&instance);
    }

    let static_bundle = !args.run.no_frontend && !args.infra_only;
    let plan = BringUp {
        vite: false,
        static_bundle,
        // Headless stacks serve agents on Cursor Cloud dev boxes, which have no
        // cloudflared and no @cursor sessions to feed; the egress stays in-network
        // and previews stay reachable on that box only.
        share_app: false,
        infra_only: args.infra_only,
        start: Start::Fresh,
    };
    let stack_up = super::bring_up(&stage, mode, &mut instance, &args.run, &plan)?;
    if !args.infra_only {
        stage.print_timings("bring-up");
        super::print_stack_summary(mode, &instance, &stack_up, &plan)?;
        stage.note(&format!(
            "  headless: `just stack status`, `just stack update`, `just stack down`{}",
            instance_suffix(&instance)
        ));
    }
    if args.json {
        println!(
            "{}",
            serde_json::to_string(&summary_json(
                mode,
                &instance,
                static_bundle.then(|| frontend::static_url(&instance)),
                static_bundle,
            ))?
        );
    }
    Ok(instance)
}

/// `cargo x stack update` — adopt a new build into the running stack. Volumes
/// stay. With no recorded stack this bootstraps through [`up`], but only on an
/// instance with nothing to lose: `up` deletes volumes.
pub fn update(args: &UpdateArgs) -> Result<()> {
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    if read_state(&instance).is_some() {
        let stage = Stage::from_env_cli(args.verbose);
        return update_running(&stage, args).map(|_| ());
    }
    if !args.wipe_if_unrecorded && super::instance_has_volumes(&instance)? {
        bail!(
            "instance {0} has data but no recorded stack, and bootstrapping would wipe it. \
             `just run_local --instance {0}` brings it up keeping its data; \
             `just stack update --wipe-if-unrecorded` wipes it",
            instance.name()
        );
    }
    bootstrap_from_update(args)
}

/// The rebuild behind `run_local rebuild`, on an instance known to be recorded.
pub(super) fn rebuild_recorded(stage: &Stage, args: &UpdateArgs) -> Result<Vec<String>> {
    update_running(stage, args)
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
            verbose: args.verbose,
            no_snapshot: false,
            traces: super::cli::TracesBackend::default(),
            with_chrome: false,
            with_cf_tunnel: false,
        },
        infra_only: false,
        json: args.json,
    };
    up(Mode::Local, &up_args).map(|_| ())
}

fn update_running(stage: &Stage, args: &UpdateArgs) -> Result<Vec<String>> {
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    let state = read_state(&instance).context("no recorded stack to update")?;
    let mode = mode_from_label(&state.mode)?;
    stage.section(&format!(
        "macro {} stack update — instance {}",
        mode.label(),
        instance.name()
    ));

    let env = env_layer::resolve(
        mode,
        &instance,
        args.env.no_doppler || state.no_doppler,
        args.env.env_file.as_deref().or(state.env_file.as_deref()),
        state.serves_bundle(),
        Tunnels {
            egress: state.egress_url.as_deref(),
            preview_ssh: state.preview_ssh_host.as_deref(),
        },
        state.traces_enabled,
    )?;
    let mut reloaded = Vec::new();
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
                remount(stage, mode, &instance, &env, &new, &state)?;
                true
            }
        }
    } else {
        let target = arch::detect()?;
        reloaded = super::rebuild_and_reload(
            stage,
            mode,
            &instance,
            &env,
            target,
            args.build_aux_services,
        )?;
        false
    };

    if args.binaries_dir.is_some() && args.build_aux_services {
        super::build_aux_service_images(stage, &instance, &env)?;
        super::recreate_aux_service_containers(stage, &instance, &env)?;
    }

    if args.frontend {
        reload_static_frontend(stage, &instance, mode, &env, &state)?;
    }
    if mode.spec().wait_backend_before_frontend {
        frontend::wait_backend_ready(stage, &instance)?;
    }
    if args.json {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "remounted": remounted,
                "frontend_updated": args.frontend,
                "aux_services_rebuilt": args.build_aux_services,
                "reloaded": reloaded,
            }))?
        );
    }
    Ok(reloaded)
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
    super::gen_compose::generate(mode, instance, new, state.serves_bundle(), gmail_forwarder)?;
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
            shares_bundle: state.shares_bundle,
            no_doppler: state.no_doppler,
            env_file: state.env_file.clone(),
            egress_url: state.egress_url.clone(),
            preview_ssh_host: state.preview_ssh_host.clone(),
            traces_enabled: state.traces_enabled,
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
    if !state.serves_bundle() {
        if state.frontend == "vite" {
            // Vite already serves the edits; there is no bundle to rebuild.
            stage.note("this stack runs Vite, which picks up frontend edits itself");
            return Ok(());
        }
        bail!(
            "instance {0} has no frontend to rebuild. `just run_local --fresh --instance {0}` \
             starts one, and wipes the instance's data",
            instance.name()
        );
    }
    frontend::build_static(stage, instance, mode)?;
    // build_static replaces the staged directory, so the container must be
    // recreated to establish a bind mount to the new inode.
    let mut up = super::compose_cmd(instance, env);
    up.args(["up", "-d", "--force-recreate", "--no-deps", "proxy"]);
    stage.run("Recreating proxy (frontend bundle)", &mut up)
}

/// What state an instance is in, as `status` reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// A bring-up is running.
    Starting,
    /// Backend and frontend answer.
    Ready,
    /// Containers run, but the backend or frontend does not answer.
    Degraded,
    /// The last bring-up failed, or died. Containers may still be up to inspect.
    Failed,
    /// No container is running. Data is kept until something wipes it.
    Stopped,
    /// Containers run, but no flow has recorded a stack: an older instance, or one
    /// started by hand. `run_local` adopts it, keeping its data.
    Unrecorded,
}

/// What decides an instance's [`Phase`].
#[derive(Clone, Copy, Debug)]
pub(super) struct PhaseInputs {
    /// The latest job's kind and status, and whether a process is still running it.
    pub job: Option<(JobKind, JobStatus, bool)>,
    pub recorded: bool,
    pub any_container_running: bool,
    pub backend_healthy: bool,
    /// Whether the frontend the stack should have is answering.
    pub frontend_healthy: bool,
}

pub(super) fn derive_phase(inputs: PhaseInputs) -> Phase {
    if let Some((JobKind::Up, status, alive)) = inputs.job {
        match status {
            JobStatus::Running if alive => return Phase::Starting,
            JobStatus::Running | JobStatus::Failed => return Phase::Failed,
            JobStatus::Succeeded => {}
        }
    }
    if !inputs.any_container_running {
        return Phase::Stopped;
    }
    if !inputs.recorded {
        return Phase::Unrecorded;
    }
    if inputs.backend_healthy && inputs.frontend_healthy {
        Phase::Ready
    } else {
        Phase::Degraded
    }
}

struct Observed {
    state: Option<StackState>,
    services: Vec<ServiceStatus>,
    backend_healthy: bool,
    frontend_healthy: bool,
    phase: Phase,
}

fn observe(instance: &Instance) -> Result<Observed> {
    let state = read_state(instance);
    let services = compose_ps(instance)?;
    let any_container_running = services.iter().any(|s| s.state == "running");
    let backend_healthy =
        any_container_running && probe(&format!("{}/auth/health", proxy::url(instance)));
    let frontend_healthy = match state.as_ref().map(|s| s.frontend.as_str()) {
        Some("vite") => {
            supervisor::supervisor_alive(instance)
                && super::summary::port_open(instance.port(Port::Frontend))
        }
        Some("static") => probe(&frontend::static_url(instance)),
        _ => true,
    };
    let phase = derive_phase(PhaseInputs {
        job: supervisor::job_state(instance),
        recorded: state.is_some(),
        any_container_running,
        backend_healthy,
        frontend_healthy,
    });
    Ok(Observed {
        state,
        services,
        backend_healthy,
        frontend_healthy,
        phase,
    })
}

pub(super) fn current_phase(instance: &Instance) -> Result<Phase> {
    Ok(observe(instance)?.phase)
}

/// The instance's whole state as JSON: what `status --json` prints, and the final
/// line of `run_local --json`, `wait --json`, and `rebuild --json`.
pub(super) fn status_json(instance: &Instance) -> Result<serde_json::Value> {
    let observed = observe(instance)?;
    let state = observed.state.as_ref();
    let mut out = summary_json(
        state.map_or(Mode::Local, |s| {
            mode_from_label(&s.mode).unwrap_or(Mode::Local)
        }),
        instance,
        state.and_then(|s| s.frontend_url(instance)),
        state.is_some_and(StackState::serves_bundle),
    );
    out["phase"] = json!(observed.phase);
    out["running"] = json!(observed.services.iter().any(|s| s.state == "running"));
    out["recorded"] = json!(state.is_some());
    out["backend_healthy"] = json!(observed.backend_healthy);
    out["frontend"] = json!(state.map(|s| s.frontend.clone()));
    out["frontend_healthy"] = json!(observed.frontend_healthy);
    out["supervisor_alive"] = json!(supervisor::supervisor_alive(instance));
    out["job"] = supervisor::job_json(instance);
    out["services"] = json!(observed.services);
    Ok(out)
}

/// `run_local status` and `cargo x stack status` — phase, endpoints, and container
/// states, as a human summary or `--json` for machines.
pub fn status(args: &StatusArgs) -> Result<()> {
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    if args.json {
        println!("{}", serde_json::to_string(&status_json(&instance)?)?);
        return Ok(());
    }

    let observed = observe(&instance)?;
    println!("instance {}: {:?}", instance.name(), observed.phase);
    if let Some(job) = supervisor::read_job(&instance) {
        println!(
            "  last job  {:?} {:?}, at {}",
            job.kind,
            job.status,
            job.failed_step
                .or(job.step)
                .as_deref()
                .unwrap_or("its first step")
        );
        if let Some(log) = job.log {
            println!("  job log   {}", log.display());
        }
    }
    super::status::run(&instance)
}

/// `cargo x stack down` — reclaim the instance: containers, volumes, networks,
/// and state. `--keep-data` only stops containers.
pub fn down(args: &DownArgs) -> Result<()> {
    if args.keep_data {
        return super::stop(&args.instance);
    }
    super::destroy(&args.instance)
}

/// The machine-readable endpoint block `stack up --json` and `status --json` share.
fn summary_json(
    mode: Mode,
    instance: &Instance,
    frontend_url: Option<String>,
    serves_bundle: bool,
) -> serde_json::Value {
    let mailpit_url = mode.spec().runs_local_infra.then(|| {
        if serves_bundle {
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
        "frontend_url": frontend_url,
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
    let mut cmd = Command::new("curl");
    cmd.args(["-fsS", "-m", "3", "-o", "/dev/null"]);
    cmd.args(super::proxy::curl_ca_args(url));
    cmd.arg(url);
    cmd.status().map(|s| s.success()).unwrap_or(false)
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
    super::summary::instance_flags(instance)
}

#[cfg(test)]
mod test;
