//! Database service wrapper.

#[cfg(test)]
pub use MockSeedDb as Db;
#[cfg(not(test))]
pub use SeedDb as Db;

#[allow(unused_imports)]
use mockall::automock;

use comms_db_client::channels::create_channel::CreateChannelOptions;
use comms_db_client::channels::seed_channel::SeedChannelOptions;
use comms_db_client::messages::create_message::CreateMessageOptions;
use comms_db_client::messages::seed_message::SeedMessageOptions;

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

    /// Seed a channel with a pre-defined UUID.
    #[tracing::instrument(skip(self), err)]
    pub async fn seed_channel(&self, options: SeedChannelOptions) -> anyhow::Result<uuid::Uuid> {
        let id =
            comms_db_client::channels::seed_channel::seed_channel(&self.inner, options).await?;
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

    /// Seed a message with a pre-defined UUID.
    #[tracing::instrument(skip(self), err)]
    pub async fn seed_message(&self, options: SeedMessageOptions) -> anyhow::Result<uuid::Uuid> {
        let message =
            comms_db_client::messages::seed_message::seed_message(&self.inner, options).await?;
        Ok(message.id)
    }
}
