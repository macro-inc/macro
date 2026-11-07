//! CI check: the Doppler `dev` and `prd` configs load as [`config::Config`].

use macro_env::Environment;

#[expect(dead_code, reason = "only loaded, never read")]
mod config;

const DOPPLER_PROJECT: &str = "agent-git-service";

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    for environment in [Environment::Develop, Environment::Production] {
        let doppler = doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .config(environment.to_doppler_slug())
            .project(DOPPLER_PROJECT)
            .build()?;

        doppler.load::<config::Config>().await?;
    }

    Ok(())
}
