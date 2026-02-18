#![deny(missing_docs)]
//! The Seed CLI to enable easy populate Macro with seed data

mod config;
mod entity;
mod service;

use anyhow::Context;
use clap::Parser;
use entity::EntityCommand;
use fusionauth::FusionAuthClient;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use service::{auth::Auth, db::Db};
use sqlx::postgres::PgPoolOptions;

use crate::{
    config::{EnvVars, SeedCliContext},
    service::s3::S3,
};

/// The Seed CLI for populating Macro with seed data.
#[derive(Debug, Parser)]
#[command(name = "seed_cli", about = "Seed CLI to populate Macro with seed data")]
pub struct Cli {
    /// The entity and action to perform
    #[command(subcommand)]
    pub command: EntityCommand,
}

/// Entrypoint for cli
#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    // Force to use local tracing
    MacroEntrypoint::new(Environment::Local).init();
    let env_vars = EnvVars::new()?;
    tracing::trace!("initializing");

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(95)
        .connect(
            &env_vars
                .database_url
                .replace("postgres:5432", "localhost:5432"),
        )
        .await
        .context("could not connect to db")?;
    tracing::trace!("initialized db");

    let fusionauth_client = FusionAuthClient::new(
        env_vars.fusionauth_tenant_id.to_string(),
        env_vars.fusionauth_api_key_secret_key.to_string(),
        env_vars.fusionauth_client_id.to_string(),
        env_vars.fusionauth_client_secret_key.to_string(),
        transform_docker_url(&env_vars.fusionauth_base_url),
        "".to_string(), // NOTE: Not needed. Oauth redirect uri
        "".to_string(), // NOTE: Not needed. Google Client id
        "".to_string(), // NOTE: Not needed. Google client secret
    );
    tracing::trace!("initialized fusionauth client");

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let s3_config = aws_sdk_s3::config::Builder::from(&aws_config)
        .force_path_style(macro_aws_config::is_local_aws())
        .build();

    let context = SeedCliContext {
        db: Db::new(db),
        fusionauth_client: Auth::new(fusionauth_client),
        s3: S3::new(
            &env_vars.document_storage_bucket,
            aws_sdk_s3::Client::from_conf(s3_config),
        ),
    };

    let cli = Cli::parse();
    cli.command.execute(context).await
}

/// Transforms the docker-network url to be localhost
fn transform_docker_url(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("http://")
        && let Some(colon_pos) = rest.find(':')
    {
        return format!("http://localhost{}", &rest[colon_pos..]);
    }
    url.to_string()
}
