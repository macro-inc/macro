//! The sole responsibility of this crate is to expose the statically imported sql migrations for macro_db.
//!
//! We explicitly do not want these migrations to exist as part of macro_db_client crate because that crate is very heavy.
pub static MACRO_DB_MIGRATIONS: sqlx::migrate::Migrator =
    sqlx::migrate!("../macro_db_client/migrations");
