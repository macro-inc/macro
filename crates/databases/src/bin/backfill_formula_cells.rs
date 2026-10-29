//! Store the cells of every formula column created before formula values
//! were stored. Each table is one batch under its own lock; a table whose
//! cells are already right is left at its version, so a second run changes
//! nothing.

use std::time::Instant;

use anyhow::Context as _;
use clap::Parser;
use database_env_vars::DatabaseUrl;
use databases::backfill::{backfill_table, tables_with_formulas};
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[derive(Parser)]
#[command(about = "Store the cells of formula columns created before they were stored")]
struct Arguments {
    /// List the tables with a formula column, and change nothing.
    #[arg(long)]
    dry_run: bool,
}

#[derive(Default)]
struct Progress {
    changed: usize,
    unchanged: usize,
    failed: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let arguments = Arguments::parse();

    let database_url = DatabaseUrl::new().context("DATABASE_URL must be provided")?;
    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(2)
        .connect(database_url.as_ref())
        .await
        .context("could not connect to db")?;

    let tables = tables_with_formulas(&pool).await?;
    println!("tables with a formula column: {}", tables.len());
    if arguments.dry_run {
        for (database_id, table_id) in &tables {
            println!("database={database_id} table={table_id}");
        }
        return Ok(());
    }

    let mut total = Progress::default();
    for (database_id, table_id) in tables {
        let started = Instant::now();
        match backfill_table(&pool, database_id, table_id).await {
            Ok(backfill) => {
                if backfill.changed {
                    total.changed += 1;
                } else {
                    total.unchanged += 1;
                }
                println!(
                    "database={database_id} table={table_id} rows={} changed={} ms={}",
                    backfill.rows,
                    backfill.changed,
                    started.elapsed().as_millis()
                );
            }
            Err(error) => {
                total.failed += 1;
                tracing::error!(
                    error=?error,
                    %database_id,
                    %table_id,
                    "failed to backfill the table's formula cells"
                );
                println!(
                    "database={database_id} table={table_id} failed ms={}",
                    started.elapsed().as_millis()
                );
            }
        }
    }

    println!(
        "total changed={} unchanged={} failed={}",
        total.changed, total.unchanged, total.failed
    );
    if total.failed > 0 {
        anyhow::bail!("the formula cell backfill completed with failures");
    }
    Ok(())
}
