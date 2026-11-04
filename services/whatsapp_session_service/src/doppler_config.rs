//! Checks that Doppler `dev` and `prd` hold every key [`Config`] reads.

use macro_env::Environment;
use whatsapp_session_service::config::Config;

const DOPPLER_PROJECT: &str = "whatsapp-session-service";

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    for environment in [Environment::Develop, Environment::Production] {
        doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .config(environment.to_doppler_slug())
            .project(DOPPLER_PROJECT)
            .build()
            .map_err(|error| rootcause::report!("invalid Doppler settings: {error:?}"))?
            .load::<Config>()
            .await
            .map_err(|error| rootcause::report!("Doppler config is incomplete: {error:?}"))?;
    }
    Ok(())
}
