//! Database service wrapper.

#[cfg(test)]
pub use MockSeedDb as Db;
#[cfg(not(test))]
pub use SeedDb as Db;

#[allow(unused_imports)]
use mockall::automock;

use comms_db_client::channels::create_channel::CreateChannelOptions;
use comms_db_client::messages::create_message::CreateMessageOptions;

/// Wrapper around the database connection pool.
pub struct SeedDb {
    /// The macrodb pool
    inner: sqlx::PgPool,
}

#[cfg_attr(test, automock)]
impl SeedDb {
    /// Create a new database wrapper.
    pub fn new(inner: sqlx::PgPool) -> Self {
        Self { inner }
    }

    /// Create a channel in the database.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_channel(
        &self,
        options: CreateChannelOptions,
    ) -> anyhow::Result<uuid::Uuid> {
        let id =
            comms_db_client::channels::create_channel::create_channel(&self.inner, options).await?;
        Ok(id)
    }

    /// Create a message in the database.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_message(
        &self,
        options: CreateMessageOptions,
    ) -> anyhow::Result<uuid::Uuid> {
        let message =
            comms_db_client::messages::create_message::create_message(&self.inner, options).await?;
        Ok(message.id)
    }
}
