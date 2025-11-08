mod api;
mod config;

use anyhow::Context;
use config::Config;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

const DEFALT_DB_MIN_CONNECTIONS: u32 = 5;
const DEFALT_DB_MAX_CONNECTIONS: u32 = 30;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let db = PgPoolOptions::new()
        .min_connections(DEFALT_DB_MIN_CONNECTIONS)
        .max_connections(DEFALT_DB_MAX_CONNECTIONS)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    api::setup_and_serve(&config, db).await?;
    Ok(())
}
