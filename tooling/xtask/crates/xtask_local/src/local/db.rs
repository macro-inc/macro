//! Database lifecycle: migrate (idempotent) and reset (drop+create+migrate).
//! Reuses the repo's sqlx recipes rather than reimplementing them. (Deterministic
//! data seeding is a local-e2e concern, added back with that flow.)

use std::process::Command;

use anyhow::Result;

use super::instance::{Instance, Port};
use super::{stage::Stage, workspace_root};

/// Host-side DATABASE_URL for sqlx (binaries run in-container with `postgres`,
/// but host tooling connects via localhost:<mapped-port>).
fn host_database_url(instance: &Instance) -> String {
    format!(
        "postgres://user:password@localhost:{}/macrodb",
        instance.port(Port::Postgres)
    )
}

/// The macro_db_client crate dir (sqlx migrations live under ./migrations).
fn db_client_dir() -> std::path::PathBuf {
    workspace_root().join("crates/macro_db_client")
}

/// Create the database (idempotent) and run migrations.
pub fn migrate(stage: &Stage, instance: &Instance) -> Result<()> {
    let url = host_database_url(instance);

    let mut create = Command::new("sqlx");
    create
        .arg("database")
        .arg("create")
        .env("DATABASE_URL", &url);
    stage.run("Creating database (if needed)", &mut create)?;

    let mut migrate = Command::new("sqlx");
    migrate
        .arg("migrate")
        .arg("run")
        .current_dir(db_client_dir())
        .env("DATABASE_URL", &url);
    stage.run("Running migrations", &mut migrate)
}

/// Drop + recreate + migrate the instance database.
pub fn reset(stage: &Stage, instance: &Instance) -> Result<()> {
    let url = host_database_url(instance);
    let mut drop = Command::new("sqlx");
    drop.arg("database")
        .arg("drop")
        .arg("-y")
        .env("DATABASE_URL", &url);
    let _ = stage.run("Dropping database", &mut drop);
    migrate(stage, instance)
}
