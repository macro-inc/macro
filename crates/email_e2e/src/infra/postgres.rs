//! One Postgres database per scenario, cloned from a migrated template.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: database DDL and seed rows are not checked against the query cache"
)]

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use rootcause::prelude::*;
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, Connection, PgConnection, PgPool};
use uuid::Uuid;

/// The session lock that makes one process at a time build the template.
const TEMPLATE_LOCK: i64 = 0x656d_6169_6c65_3265;
/// How much of the migrations' digest names a template.
const TEMPLATE_NAME_DIGITS: usize = 16;

/// A scenario's own database on the suite's Postgres server.
pub(crate) struct Database {
    name: String,
    server: PgConnectOptions,
    pool: PgPool,
}

impl Database {
    /// Clones the migrated template into a new database.
    pub(crate) async fn create(server_url: &str) -> Result<Self, Report> {
        let server: PgConnectOptions = server_url.parse().context(
            "the Postgres server address (EMAIL_E2E_DATABASE_URL) is not a Postgres URL",
        )?;
        let mut admin = PgConnection::connect_with(&server)
            .await
            .context("could not connect to the Postgres server (EMAIL_E2E_DATABASE_URL)")?;

        let template = ensure_template(&mut admin, &server).await?;
        let name = format!("email_e2e_{}", Uuid::now_v7().simple());
        sqlx::query(&format!(
            r#"CREATE DATABASE "{name}" TEMPLATE "{template}""#
        ))
        .execute(&mut admin)
        .await
        .context("could not create the scenario database")?;
        admin.close().await.ok();

        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect_with(server.clone().database(&name))
            .await
            .context("could not connect to the scenario database")?;

        Ok(Self { name, server, pool })
    }

    /// The URL the services connect with.
    pub(crate) fn url(&self) -> String {
        self.server
            .clone()
            .database(&self.name)
            .to_url_lossy()
            .to_string()
    }

    /// A pool on the scenario's database, for fixtures and for assertions the
    /// API cannot answer.
    pub(crate) fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Drops the database. The services must have stopped.
    pub(crate) async fn drop_database(self) -> Result<(), Report> {
        self.pool.close().await;
        let mut admin = PgConnection::connect_with(&self.server).await?;
        sqlx::query(&format!(
            r#"DROP DATABASE IF EXISTS "{}" WITH (FORCE)"#,
            self.name
        ))
        .execute(&mut admin)
        .await
        .context("could not drop the scenario database")?;
        admin.close().await.ok();
        Ok(())
    }
}

/// Returns the name of a template database holding the current migrations,
/// building it when this checkout's migrations have no template yet.
///
/// The template is named after the content of the migrations it holds, so
/// checkouts with different migrations can share one server and an edited
/// migration gets a new template. Templates of other migrations stay on the
/// server until someone drops them.
async fn ensure_template(
    admin: &mut PgConnection,
    server: &PgConnectOptions,
) -> Result<String, Report> {
    let mut content = Sha256::new();
    for migration in MACRO_DB_MIGRATIONS.iter() {
        content.update(migration.version.to_be_bytes());
        content.update(&migration.checksum);
    }
    let content = hex::encode(content.finalize());
    let template = format!(
        "email_e2e_template_{}",
        content.get(..TEMPLATE_NAME_DIGITS).unwrap_or(&content)
    );

    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(TEMPLATE_LOCK)
        .execute(&mut *admin)
        .await?;
    let built = build_template(admin, server, &template).await;
    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(TEMPLATE_LOCK)
        .execute(&mut *admin)
        .await?;
    built?;

    Ok(template)
}

async fn build_template(
    admin: &mut PgConnection,
    server: &PgConnectOptions,
    template: &str,
) -> Result<(), Report> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)")
            .bind(template)
            .fetch_one(&mut *admin)
            .await?;
    if exists {
        return Ok(());
    }

    // Migrate under a temporary name, so a template that exists is complete.
    let building = format!("{template}_building");
    sqlx::query(&format!(
        r#"DROP DATABASE IF EXISTS "{building}" WITH (FORCE)"#
    ))
    .execute(&mut *admin)
    .await?;
    sqlx::query(&format!(r#"CREATE DATABASE "{building}""#))
        .execute(&mut *admin)
        .await?;

    let mut connection = PgConnection::connect_with(&server.clone().database(&building)).await?;
    // A server whose `template1` is already migrated (CI's) hands over the
    // schema with the new database; the migrator then has nothing to apply.
    MACRO_DB_MIGRATIONS
        .run(&mut connection)
        .await
        .context("could not migrate the template database")?;
    connection.close().await.ok();

    sqlx::query(&format!(
        r#"ALTER DATABASE "{building}" RENAME TO "{template}""#
    ))
    .execute(&mut *admin)
    .await?;
    Ok(())
}
