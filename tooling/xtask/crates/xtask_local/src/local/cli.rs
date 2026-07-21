//! The clap-based CLI for the local/dev orchestration surface. The repo's other
//! xtask verbs (deps/workflows/...) keep their slice-pattern match in main.rs;
//! everything else routes here.

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
    /// Stop an instance's containers (keep volumes).
    StopLocal(InstanceArgs),
    /// Drop, recreate, and migrate the instance database.
    ResetLocal(InstanceArgs),
    /// Remove an instance's containers, networks, and volumes.
    DestroyLocal(InstanceArgs),
    /// Start, seed, and test an isolated local E2E stack.
    LocalE2e(super::e2e::LocalE2eArgs),
    /// Headless stack orchestration (previews, agents, CI) — no TTY, no
    /// attached dev server; the proxy serves a static frontend bundle.
    #[command(subcommand)]
    Stack(StackCmd),
}

#[derive(Subcommand)]
pub enum StackCmd {
    /// Bring a full local stack up and return (only containers keep running).
    Up(super::stack::UpArgs),
    /// Rebuild binaries (and optionally the frontend) and reload what changed.
    Update(super::stack::UpdateArgs),
    /// Report the instance's containers, health, and URLs (`--json` for machines).
    Status(super::stack::StatusArgs),
    /// Tear the instance down: containers, volumes, and state.
    Down(super::stack::DownArgs),
    /// Report the init-snapshot key/location for this instance.
    Snapshot(super::stack::SnapshotArgs),
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
    /// Rebuild Docker-built auxiliary services (sync, websocket, lexical).
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
    /// Stream subprocess output and show per-step timings.
    #[arg(long, short)]
    pub verbose: bool,
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
    /// Rebuild even if the image already exists.
    #[arg(long)]
    pub force: bool,
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
        Cmd::StopLocal(a) => super::stop(&a),
        Cmd::ResetLocal(a) => super::reset(&a),
        Cmd::DestroyLocal(a) => super::destroy(&a),
        Cmd::LocalE2e(a) => super::e2e::run(&a),
        Cmd::Stack(cmd) => match cmd {
            StackCmd::Up(a) => super::stack::up(Mode::Local, &a).map(|_| ()),
            StackCmd::Update(a) => super::stack::update(&a),
            StackCmd::Status(a) => super::stack::status(&a),
            StackCmd::Down(a) => super::stack::down(&a),
            StackCmd::Snapshot(a) => super::stack::snapshot_status(&a),
        },
    }
}

#[cfg(test)]
mod test;
