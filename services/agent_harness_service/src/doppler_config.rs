#![allow(unused)]
#![recursion_limit = "256"]

use macro_env::Environment;

mod config;
#[path = "preview/config.rs"]
mod preview_config;
#[path = "scheduling/config.rs"]
mod scheduling_config;

const DOPPLER_PROJECT: &str = "agent-harness-service";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dev = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Develop.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    dev.load::<config::Config>().await?;
    dev.load::<preview_config::Config>().await?;
    dev.load::<scheduling_config::Config>().await?;
    dev.load::<agent_harness_service::cognition::config::Config>()
        .await?;

    let prd = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Production.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    prd.load::<config::Config>().await?;
    prd.load::<preview_config::Config>().await?;
    prd.load::<scheduling_config::Config>().await?;
    prd.load::<agent_harness_service::cognition::config::Config>()
        .await?;

    Ok(())
}
