#![allow(unused)]

use macro_env::Environment;

mod config;

const DOPPLER_PROJECT: &str = "calendar-event-local-tunnel";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Dev-only service: there is no prd config to validate.
    let dev = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Develop.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    dev.load::<config::Config>().await?;
    Ok(())
}
