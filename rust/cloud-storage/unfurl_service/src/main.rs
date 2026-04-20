#![recursion_limit = "256"]
mod api;
mod config;
mod http_safety;
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

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .context("failed to build http client")?;

    let state = api::context::ApiContext {
        environment: config.environment,
        http_client,
    };

    api::setup_and_serve(state, config.port).await?;
    Ok(())
}
