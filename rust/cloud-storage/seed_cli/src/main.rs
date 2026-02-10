#![deny(missing_docs)]
//! The Seed CLI to enable easy populate Macro with seed data

mod config;
mod entity;

use anyhow::Context;
use clap::Parser;
use entity::EntityCommand;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use sqlx::postgres::PgPoolOptions;

use crate::config::{EnvVars, SeedCliContext};

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
        .max_connections(50)
        .connect(&env_vars.database_url)
        .await
        .context("could not connect to db")?;

    let _context = SeedCliContext { db };

    let cli = Cli::parse();
    cli.command.execute().await
}
