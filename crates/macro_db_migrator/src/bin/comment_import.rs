//! Online, idempotent import of legacy document comments into the shared
//! message store. Safe to rerun while the application keeps serving requests.

#[path = "comment_import/runner.rs"]
mod runner;

use clap::Parser;
use database_env_vars::DatabaseUrl;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use sqlx::{Connection, PgConnection};

#[derive(Debug, Parser)]
#[command(
    about = "Import legacy document comments into comms_messages while the application stays live"
)]
struct Args {
    /// Documents imported per transaction. Smaller batches hold the legacy
    /// table lock for less time; larger batches finish sooner.
    #[arg(long, default_value_t = runner::DEFAULT_DOCUMENTS_PER_BATCH)]
    documents_per_batch: i64,
    /// Run the preflight and report pending work without writing anything.
    #[arg(long)]
    check: bool,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    let entrypoint = MacroEntrypoint::new(Environment::Local).init();
    let database_url = DatabaseUrl::new()?;
    let mut connection = PgConnection::connect(database_url.as_ref()).await?;
    let report = if args.check {
        runner::check(&mut connection).await?.to_string()
    } else {
        let options = runner::Options {
            documents_per_batch: args.documents_per_batch,
        };
        runner::run(&mut connection, options).await?.to_string()
    };
    println!("{report}");
    connection.close().await?;
    entrypoint.shutdown();
    Ok(())
}
