#![allow(unused)]
#![recursion_limit = "256"]

use macro_env::Environment;

mod config;

const DOPPLER_PROJECT: &str = "authentication-service";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dev = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Develop.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    let dev_config = dev.load::<config::Config>().await?;
    dev_config.signup_policy_for_environment(Environment::Develop)?;

    let prd = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Production.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    let prd_config = prd.load::<config::Config>().await?;
    prd_config.signup_policy_for_environment(Environment::Production)?;

    Ok(())
}
