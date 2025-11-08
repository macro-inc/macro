mod api;
mod config;
mod unfurl;
use anyhow::Context;
use config::Config;
use macro_entrypoint::MacroEntrypoint;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");
    api::setup_and_serve(&config).await?;
    Ok(())
}
