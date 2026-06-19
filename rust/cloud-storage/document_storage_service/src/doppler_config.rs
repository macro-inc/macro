#![allow(unused)]
#![recursion_limit = "256"]

use macro_env::Environment;

mod config;

const DOPPLER_PROJECT: &str = "cloud-storage-service";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Testing configuration against doppler");
    let doppler = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Develop.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    doppler.load::<config::Config>().await?;

    // TODO: For each Environment dev and prd:
    // TODO: Grab doppler environment as JSON
    // INJECT APP_SECRETS_JSON INTO .env?
    // Load against config
    // Error out if config is missing things?
    //
    Ok(())
}
