#![allow(unused)]
#![recursion_limit = "256"]

use macro_env::Environment;
use scheduled_action::config::Config;

const DOPPLER_PROJECT: &str = "agent-schedule-service";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dev = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Develop.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    dev.load::<Config>().await?;

    let prd = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Production.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    prd.load::<Config>().await?;

    Ok(())
}
