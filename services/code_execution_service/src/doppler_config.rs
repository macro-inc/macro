//! Validate registered configuration for both deployment environments.

#[expect(
    dead_code,
    reason = "configuration fields are deserialized for validation"
)]
mod config;

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    for environment in ["dev", "prd"] {
        doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .config(environment)
            .project("code-execution-service")
            .build()?
            .load::<config::Config>()
            .await?;
    }
    Ok(())
}
