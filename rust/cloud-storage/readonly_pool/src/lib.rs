#![deny(missing_docs)]
//! Type-safe wrapper for read-only database pool connections.

/// A newtype wrapper around `PgPool` that signals the pool connects to a read-only replica.
/// Use this instead of a raw `PgPool` in repos that should only perform read queries,
/// so it's impossible to accidentally pass a read-write pool.
#[derive(Clone)]
pub struct ReadOnlyPool(pub sqlx::PgPool);

impl std::ops::Deref for ReadOnlyPool {
    type Target = sqlx::PgPool;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
