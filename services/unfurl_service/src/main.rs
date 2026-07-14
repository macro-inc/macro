#![recursion_limit = "256"]
mod api;
mod config;
mod http_safety;
mod unfurl;
use ::unfurl::{
    domain::service::UnfurlServiceImpl, inbound::axum_router::UnfurlRouterState,
    outbound::ReqwestUnfurlFetcher,
};
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

    // ReqwestUnfurlFetcher owns its own client with redirects disabled to
    // close the SSRF redirect-bypass: a 302 → internal IP must not be
    // followed past the assert_not_internal preflight on the original URL.
    let unfurl_fetcher =
        ReqwestUnfurlFetcher::new().context("failed to build unfurl http client")?;
    let unfurl_state = UnfurlRouterState::new(UnfurlServiceImpl::new(unfurl_fetcher));

    api::setup_and_serve(state, unfurl_state, config.port).await?;
    Ok(())
}
