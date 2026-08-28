//! The clap-based CLI for the local/dev orchestration surface. The repo's other
//! xtask verbs (deps/workflows/...) keep their slice-pattern match in main.rs;
//! everything else routes here.

use std::ffi::OsString;
use std::path::PathBuf;

use anyhow::Result;
use clap::{Args, Parser, Subcommand};

use super::Mode;

#[derive(Parser)]
#[command(name = "cargo-x", about = "Macro local & dev orchestration")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Start a fully local stack (infra + binaries + proxy + frontend).
    RunLocal(RunArgs),
    /// Run local binaries against shared dev resources.
    RunDev(RunArgs),
    /// Cross-compile the local service binaries with cargo zigbuild.
    Zigbuild,
    /// Build the minimal runtime image.
    RuntimeImage(ForceArg),
    /// Render the per-instance compose override and print its path.
    GenCompose(InstanceArgs),
    /// Render merged compose and assert the no-build / runtime-image invariants.
    ValidateLocalCompose(InstanceArgs),
    /// Resolve env layers and assert mode-appropriate invariants.
    ValidateLocalEnv(ValidateEnvArgs),
    /// Create the declared Kafka event topics on the instance's local broker.
    KafkaProvision(InstanceArgs),
    /// Preflight checks (docker, toolchain, ports, env sources, images).
    DoctorLocal(InstanceArgs),
    /// Show an instance's endpoints and container states without starting anything.
    StatusLocal(InstanceArgs),
    /// Emit host-facing connection env for seeding an instance (eval in a shell).
    SeedEnv(InstanceArgs),
    /// Run a seed scenario against an instance's host-facing endpoints.
    SeedScenario(SeedScenarioArgs),
    /// Stop an instance's containers (keep volumes).
    StopLocal(InstanceArgs),
    /// Drop, recreate, and migrate the instance database.
    ResetLocal(InstanceArgs),
    /// Remove an instance's containers, networks, and volumes.
    DestroyLocal(InstanceArgs),
    /// Start, seed, and test an isolated local E2E stack.
    LocalE2e(super::e2e::LocalE2eArgs),
    /// Headless stack orchestration (agents, CI) — no TTY, no attached
    /// dev server; the proxy serves a static frontend bundle.
    #[command(subcommand)]
    Stack(StackCmd),
}

#[derive(Subcommand)]
pub enum StackCmd {
    /// Bring a full local stack up and return (only containers keep running).
    Up(super::stack::UpArgs),
    /// Adopt a new build into the running stack. Data survives.
    Update(super::stack::UpdateArgs),
    /// Report the instance's containers, health, and URLs (`--json` for machines).
    Status(super::stack::StatusArgs),
    /// Tear the instance down: containers, volumes, and state.
    Down(super::stack::DownArgs),
}

#[derive(Args, Clone, Default)]
pub struct InstanceArgs {
    /// Stack name. Absent (or `macro`) is the default instance.
    #[arg(long)]
    pub instance: Option<String>,
    /// Override the derived port base.
    #[arg(long)]
    pub port_base: Option<u16>,
}

#[derive(Args, Clone, Default)]
pub struct EnvArgs {
    /// Skip the optional Doppler layer entirely.
    #[arg(long)]
    pub no_doppler: bool,
    /// Overlay this dotenv (above defaults + Doppler, below process env).
    #[arg(long)]
    pub env_file: Option<PathBuf>,
}

#[derive(Args, Clone, Default)]
pub struct BuildArgs {
    /// Skip building; reuse whatever is in the target dir.
    #[arg(long)]
    pub no_build: bool,
    /// Rebuild every repository-built local Docker service.
    #[arg(long)]
    pub build_aux_services: bool,
    /// Use this dir as the `/app/out` source instead of building.
    #[arg(long)]
    pub binaries_dir: Option<PathBuf>,
}

#[derive(Args, Clone, Default)]
pub struct RunArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    #[command(flatten)]
    pub env: EnvArgs,
    #[command(flatten)]
    pub build: BuildArgs,
    /// Do not start or serve the frontend.
    #[arg(long)]
    pub no_frontend: bool,
    /// Turn on onboarding v4 for the attached vite server
    /// (`VITE_ENABLE_ONBOARDING_V4=true`). Off by default so signing in does
    /// not dump you into the stepper. No effect on `stack up` static bundles.
    #[arg(long)]
    pub enable_onboarding: bool,
    /// Stream subprocess output and show per-step timings.
    #[arg(long, short)]
    pub verbose: bool,
    /// Start a local OTLP trace collector and wire services to export to it.
    /// Omit to leave tracing off (the default) — see `docker/docker-compose.yml`
    /// for what each backend does.
    #[arg(long)]
    pub traces: Option<TracesBackend>,
    /// Open Cloudflare quick tunnels into this stack: one for `@cursor`
    /// sessions (a public `EGRESS_BASE_URL`) and one sharing the app itself
    /// through the reverse proxy. Off by default — nothing dials out and the
    /// stack stays localhost-only. `run_local` only.
    #[arg(long)]
    pub with_cf_tunnel: bool,
}

/// Which OTLP trace collector `--traces` should bring up.
#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum TracesBackend {
    /// Fully local trace viewer at http://localhost:16686, no account needed.
    Jaeger,
    /// Forwards to Datadog APM (us5); requires `DD_API_KEY`.
    Datadog,
}

impl TracesBackend {
    /// The compose service name gated by this backend's profile.
    pub fn compose_service(self) -> &'static str {
        match self {
            TracesBackend::Jaeger => "jaeger",
            TracesBackend::Datadog => "datadog-agent",
        }
    }

    /// The compose profile gating this backend's service.
    pub fn compose_profile(self) -> &'static str {
        match self {
            TracesBackend::Jaeger => "jaeger",
            TracesBackend::Datadog => "datadog",
        }
    }

    /// Env var the backend needs to forward telemetry, if any. Checked
    /// before starting the collector so a missing key fails loud instead of
    /// silently dropping everything at the intake.
    pub fn required_env(self) -> Option<&'static str> {
        match self {
            TracesBackend::Jaeger => None,
            TracesBackend::Datadog => Some("DD_API_KEY"),
        }
    }
}

#[derive(Args, Clone, Default)]
pub struct ValidateEnvArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    #[command(flatten)]
    pub env: EnvArgs,
    /// Validate against dev-mode requirements instead of local.
    #[arg(long)]
    pub dev: bool,
}

#[derive(Args, Clone, Default)]
pub struct ForceArg {
    /// Rebuild without BuildKit's layer cache.
    #[arg(long)]
    pub force: bool,
}

#[derive(Args, Clone)]
#[command(trailing_var_arg = true)]
pub struct SeedScenarioArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// Arguments forwarded to `seed_cli scenario`.
    #[arg(required = true, allow_hyphen_values = true)]
    pub scenario_args: Vec<OsString>,
}

/// Parse and run a local-orchestration command, or fall back to the legacy
/// usage message on unknown input.
pub fn dispatch(raw: &[String], legacy_usage: &str) -> Result<()> {
    let argv = std::iter::once("cargo-x".to_string()).chain(raw.iter().cloned());
    let cli = match Cli::try_parse_from(argv) {
        Ok(c) => c,
        Err(e) => {
            // For an unrecognized subcommand, also surface the legacy verbs.
            if e.kind() == clap::error::ErrorKind::InvalidSubcommand
                || e.kind() == clap::error::ErrorKind::UnknownArgument
            {
                eprintln!("{legacy_usage}\n");
            }
            e.print().ok();
            std::process::exit(e.exit_code());
        }
    };
    run(cli)
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Cmd::RunLocal(args) => super::run_stack(Mode::Local, &args),
        Cmd::RunDev(args) => super::run_stack(Mode::Dev, &args),
        Cmd::Zigbuild => super::zigbuild_only(),
        Cmd::RuntimeImage(a) => super::runtime_image_only(a.force),
        Cmd::GenCompose(a) => super::gen_compose_only(&a),
        Cmd::ValidateLocalCompose(a) => {
            let instance = super::instance::Instance::derive(a.instance.as_deref(), a.port_base)?;
            super::validate::local_compose(&instance, Mode::Local)
        }
        Cmd::ValidateLocalEnv(a) => {
            let instance = super::instance::Instance::derive(
                a.instance.instance.as_deref(),
                a.instance.port_base,
            )?;
            let mode = if a.dev { Mode::Dev } else { Mode::Local };
            super::validate::local_env(&instance, mode, a.env.no_doppler, a.env.env_file.as_deref())
        }
        Cmd::KafkaProvision(a) => {
            super::kafka::ensure_available("kafka-provision")?;
            let instance = super::instance::Instance::derive(a.instance.as_deref(), a.port_base)?;
            super::kafka::provision(&instance)
        }
        Cmd::DoctorLocal(a) => super::doctor::run(&a),
        Cmd::StatusLocal(a) => {
            let instance = super::instance::Instance::derive(a.instance.as_deref(), a.port_base)?;
            super::status::run(&instance)
        }
        Cmd::SeedEnv(a) => {
            let instance = super::instance::Instance::derive(a.instance.as_deref(), a.port_base)?;
            super::seed_env::emit(&instance)
        }
        Cmd::SeedScenario(a) => {
            let instance = super::instance::Instance::derive(
                a.instance.instance.as_deref(),
                a.instance.port_base,
            )?;
            super::seed_env::run_scenario(&instance, &a.scenario_args)
        }
        Cmd::StopLocal(a) => super::stop(&a),
        Cmd::ResetLocal(a) => super::reset(&a),
        Cmd::DestroyLocal(a) => super::destroy(&a),
        Cmd::LocalE2e(a) => super::e2e::run(&a),
        Cmd::Stack(cmd) => match cmd {
            StackCmd::Up(a) => super::stack::up(Mode::Local, &a).map(|_| ()),
            StackCmd::Update(a) => super::stack::update(&a),
            StackCmd::Status(a) => super::stack::status(&a),
            StackCmd::Down(a) => super::stack::down(&a),
        },
    }
}

#[cfg(test)]
mod test;
