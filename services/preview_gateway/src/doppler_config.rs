//! Verify the Doppler-sourced service configuration in dev and production.
#[allow(dead_code)]
mod config;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    for environment in ["dev", "prd"] {
        doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .config(environment)
            .project("preview-gateway")
            .build()?
            .load::<config::Config>()
            .await?;
    }
    Ok(())
}
