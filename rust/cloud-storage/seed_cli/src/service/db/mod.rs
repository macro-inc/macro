//! Database service wrapper.

#[cfg(test)]
pub use MockSeedDb as Db;
#[cfg(not(test))]
pub use SeedDb as Db;

#[allow(unused_imports)]
use mockall::automock;

/// Wrapper around the database connection pool.
pub struct SeedDb {
    /// The macrodb pool
    #[allow(unused)]
    inner: sqlx::PgPool,
}

#[cfg_attr(test, automock)]
impl SeedDb {
    /// Create a new database wrapper.
    pub fn new(inner: sqlx::PgPool) -> Self {
        Self { inner }
    }
}
