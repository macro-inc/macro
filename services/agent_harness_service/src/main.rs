//! Composition root for the agent harness service.
//!
//! The hexagon lives in `crates/agent_harness`; this binary is the shell around
//! it. Stubbed while the harness is reshaped: it loads config and exits.

mod config;

use crate::config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    macro_entrypoint::MacroEntrypoint::default().init();
    agent_harness::install_tls_provider();

    let config = Config::from_env()?;

    tracing::info!(environment = %config.environment, "agent harness starting");

    Ok(())
}
