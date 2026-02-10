#![deny(missing_docs)]
//! The Seed CLI to enable easy populate Macro with seed data

mod config;

use macro_entrypoint::MacroEntrypoint;

use crate::config::EnvVars;

/// Entrypoint for cli
#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    tracing::trace!("initializing");
    EnvVars::new()?;
    
    Ok(())
}
