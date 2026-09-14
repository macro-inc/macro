//! Applies the MacroDB migrations to `DATABASE_URL` and exits.
//!
//! The migrations are compiled into [`macro_db_migrator`], so this binary
//! carries the exact set its build was made from — a deployment cannot apply a
//! migration set that does not match its services. That is what lets a
//! self-hosted install run migrations from a container with no source checkout
//! and no `sqlx-cli`.
//!
//! Idempotent: sqlx records applied migrations and skips them, so running this
//! on every start is the intended use.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::postgres::PgPoolOptions;

macro_env_var::env_var! {
    /// The MacroDB connection string to migrate.
    struct DatabaseUrl;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = DatabaseUrl::new()?;

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url.as_ref())
        .await?;

    MACRO_DB_MIGRATIONS.run(&pool).await?;
    pool.close().await;

    println!("migrations applied");
    Ok(())
}
