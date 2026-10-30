use clap::{Parser, Subcommand};
use macro_env_var::env_vars;

env_vars! {
    struct DatabaseUrl;
}

/// Backfill or audit the source_items projection.
#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Fill rows for items that predate the triggers. Safe to rerun.
    Backfill,
    /// Count rows that differ from what the inputs imply, in one read-only snapshot.
    Audit,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    macro_entrypoint::MacroEntrypoint::default().init();
    let url = DatabaseUrl::new()?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(url.as_ref())
        .await?;
    match args.command {
        Command::Backfill => {
            let count = source_items::backfill::run(&pool).await?;
            println!("Backfilled {count} item keys. Run the audit before enabling reads.");
        }
        Command::Audit => {
            let mismatches = source_items::audit::run(&pool).await?;
            println!(
                "missing_or_wrong={} extra_or_wrong={}",
                mismatches.missing_or_wrong, mismatches.extra_or_wrong
            );
            if !mismatches.is_empty() {
                return Err(rootcause::report!("source_items differs from its inputs"));
            }
        }
    }
    Ok(())
}
