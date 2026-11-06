#![allow(unused)]
#![recursion_limit = "256"]

use clap::Parser;
use macro_env::Environment;

mod config;
#[path = "preview/config.rs"]
mod preview_config;
#[path = "scheduling/config.rs"]
mod scheduling_config;

const DOPPLER_PROJECT: &str = "agent-harness-service";

#[derive(Parser)]
struct Args {
    /// Validate only the dev config supplied by `doppler run`.
    #[arg(long)]
    dev_only: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let dev = if args.dev_only {
        doppler_config::DopplerConfig::from_env()
    } else {
        doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .config(Environment::Develop.to_doppler_slug())
            .project(DOPPLER_PROJECT)
            .build()
            .expect("able to grab doppler project")
    };

    validate_config(&dev).await?;
    dev.load::<preview_config::Config>().await?;
    dev.load::<scheduling_config::Config>().await?;
    dev.load::<agent_harness_service::cognition::config::Config>()
        .await?;

    if args.dev_only {
        println!("agent_harness_service dev config validated");
        return Ok(());
    }

    let prd = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Production.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    validate_config(&prd).await?;
    prd.load::<preview_config::Config>().await?;
    prd.load::<scheduling_config::Config>().await?;
    prd.load::<agent_harness_service::cognition::config::Config>()
        .await?;

    Ok(())
}

async fn validate_config(loader: &doppler_config::DopplerConfig) -> anyhow::Result<()> {
    let config = loader.load::<config::Config>().await?;
    config.livekit_credentials()?;
    match config.computers_fleet {
        config::ComputerFleetKind::Incus => {
            loader
                .load::<config::IncusFleetSettings>()
                .await?
                .validate()?;
        }
        config::ComputerFleetKind::Docker => {
            loader
                .load::<config::DockerFleetSettings>()
                .await?
                .validate()?;
        }
        config::ComputerFleetKind::Disabled => {}
    }
    Ok(())
}
