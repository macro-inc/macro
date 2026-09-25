//! Idempotent import of legacy CRM company and contact comments into the shared
//! message store. Safe to rerun while the application keeps serving requests.

#[path = "crm_comment_import/runner.rs"]
mod runner;

use clap::Parser;
use database_env_vars::DatabaseUrl;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use sqlx::{Connection, PgConnection};

#[derive(Debug, Parser)]
#[command(
    about = "Import legacy CRM comments into comms_messages while the application stays live"
)]
struct Args {
    /// Run the preflight and invariants and report pending work without writing.
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
        runner::check(&mut connection).await?
    } else {
        runner::run(&mut connection).await?
    };
    println!("{report}");
    connection.close().await?;
    entrypoint.shutdown();
    Ok(())
}
