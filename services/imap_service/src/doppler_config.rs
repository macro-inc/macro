use macro_env::Environment;
#[expect(dead_code, reason = "only the configuration shape is validated here")]
mod config;
const DOPPLER_PROJECT: &str = "imap-service";
#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    for environment in [Environment::Develop, Environment::Production] {
        let project = doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .config(environment.to_doppler_slug())
            .project(DOPPLER_PROJECT)
            .build()
            .map_err(|error| rootcause::report!("invalid Doppler validation config: {error}"))?;
        project
            .load::<config::Config>()
            .await
            .map_err(|error| rootcause::report!("IMAP configuration validation failed: {error}"))?;
    }
    Ok(())
}
