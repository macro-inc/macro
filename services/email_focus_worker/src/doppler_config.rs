#![recursion_limit = "256"]
//! Validates that the worker's configuration loads from both Doppler environments.

use macro_env::Environment;

#[expect(dead_code, reason = "only the configuration's shape is validated here")]
mod config;

/// The worker runs on the email service's Doppler project.
const DOPPLER_PROJECT: &str = "email-service";

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    for environment in [Environment::Develop, Environment::Production] {
        doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .config(environment.to_doppler_slug())
            .project(DOPPLER_PROJECT)
            .build()?
            .load::<config::Config>()
            .await?;
    }
    Ok(())
}
