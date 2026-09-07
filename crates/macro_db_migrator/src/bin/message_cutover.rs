//! Coordinated, offline cutover from document comments to entity messages.

#[path = "message_cutover/runner.rs"]
mod runner;

use clap::Parser;
use database_env_vars::DatabaseUrl;
use sqlx::{Connection, PgConnection};

#[derive(Debug, Parser)]
#[command(about = "Migrate legacy comments while application writers are paused")]
struct Args {
    #[arg(value_enum)]
    phase: runner::Phase,
    /// Assert that old writers and background deliveries have been paused and drained.
    #[arg(long)]
    writers_paused: bool,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    if !args.writers_paused {
        rootcause::bail!("Pause and drain writers first; --writers-paused records that assertion");
    }
    let database_url = DatabaseUrl::new()?;
    let mut connection = PgConnection::connect(database_url.as_ref()).await?;
    let outcome = runner::run(&mut connection, args.phase).await?;
    println!("Message cutover: {outcome:?}");
    connection.close().await?;
    Ok(())
}
