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
            let backfill = source_items::backfill::run(&pool).await?;
            println!("Backfilled {} item keys.", backfill.items);
            if !backfill.readable {
                return Err(rootcause::report!(
                    "maintenance was off or turned on again during the backfill, so reads will \
                     not trust the table: install the triggers and run the backfill again"
                ));
            }
            println!("Reads may now trust the table. Run the audit before enabling them.");
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
