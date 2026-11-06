//! Reuse local-stack preparation and initialization for a Kubernetes runtime.
//! The caller owns pods and temporary host port forwards, never Compose state.

use anyhow::Result;

use super::{Mode, cli::RunArgs, instance::Instance, local_env::Tunnels, stage::Stage};

/// Generate exactly the Compose environment, proxy, kickstart and frontend.
pub fn prepare(args: &RunArgs) -> Result<()> {
    let stage = Stage::from_env_cli(args.verbose);
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    super::prepare(
        &stage,
        Mode::Local,
        &instance,
        args,
        true,
        true,
        false,
        Tunnels::default(),
    )?;
    super::frontend::build_static(&stage, &instance, Mode::Local)
}

/// Initialize pods using the same host-facing ports as the Compose instance.
pub fn initialize(args: &RunArgs) -> Result<()> {
    super::kafka::ensure_available("kubernetes-init")?;
    let stage = Stage::from_env_cli(args.verbose);
    let instance = Instance::derive(args.instance.instance.as_deref(), args.instance.port_base)?;
    let env = super::env_layer::resolve(
        Mode::Local,
        &instance,
        args.env.no_doppler,
        args.env.env_file.as_deref(),
        true,
        Tunnels::default(),
        false,
    )?;
    super::localstack::provision(&instance)?;
    super::db::migrate(&stage, &instance)?;
    super::kafka::provision(&instance)?;
    super::fusionauth::wait_ready(&stage, &instance)?;
    super::opensearch::provision_indices(&stage, &instance, &env.merged)
}
