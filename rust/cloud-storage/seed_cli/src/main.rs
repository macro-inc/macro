//! The Seed CLI to enable easy populate Macro with seed data 

use macro_entrypoint::MacroEntrypoint;

#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    tracing::trace!("initializing");

    Ok(())
}
