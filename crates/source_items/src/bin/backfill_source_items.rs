use clap::Parser;
use macro_env_var::env_vars;

env_vars! {
    struct DatabaseUrl;
}

/// Reconcile source_items after all application writers have deployed.
#[derive(Parser)]
struct Args {}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    Args::parse();
    macro_entrypoint::MacroEntrypoint::default().init();
    let url = DatabaseUrl::new()?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(url.as_ref())
        .await?;
    let count = source_items::backfill::run(&pool).await?;
    println!("Reconciled {count} item keys. Run the parity audit before enabling reads.");
    Ok(())
}
