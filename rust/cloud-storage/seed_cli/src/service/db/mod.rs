//! Database service wrapper.

use std::str::FromStr;

#[cfg(test)]
pub use MockSeedDb as Db;
#[cfg(not(test))]
pub use SeedDb as Db;

#[allow(unused_imports)]
use mockall::automock;

use comms_db_client::channels::create_channel::CreateChannelOptions;
use comms_db_client::channels::seed_channel::SeedChannelOptions;
use comms_db_client::messages::create_message::CreateMessageOptions;
use comms_db_client::messages::create_message_mentions::CreateMessageMentionOptions;
use comms_db_client::messages::seed_message::SeedMessageOptions;
use comms_db_client::model::SimpleMention;
use model::document::DocumentMetadata;
use models_email::email::service;
use models_permissions::share_permission::access_level::AccessLevel;

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

    /// Create a document in the database.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_document<'a>(
        &self,
        args: macro_db_client::document::v2::create::CreateDocumentArgs<'a>,
    ) -> anyhow::Result<DocumentMetadata> {
        macro_db_client::document::v2::create::create_document(&self.inner, args).await
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

    /// Create entity mentions for a message.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_message_mentions(
        &self,
        message_id: uuid::Uuid,
        mentions: Vec<SimpleMention>,
    ) -> anyhow::Result<Vec<String>> {
        let options = CreateMessageMentionOptions {
            message_id,
            mentions,
        };
        comms_db_client::messages::create_message_mentions::create_message_mentions(
            &self.inner,
            options,
        )
        .await
    }

    /// Update channel share permissions for a mentioned entity (seed-data only, no access check).
    #[tracing::instrument(skip(self), err)]
    pub async fn update_share_permissions_for_mention(
        &self,
        channel_id: uuid::Uuid,
        item_id: &str,
        item_type: &str,
    ) -> anyhow::Result<()> {
        let share_permission_id = macro_db_client::share_permission::get::get_share_permission_id(
            &self.inner,
            item_id,
            item_type,
        )
        .await?;

        let channel_id_str = channel_id.to_string();
        if let Err(e) =
            macro_db_client::share_permission::channel_permission::create::insert_channel_share_permission(
                &self.inner,
                &share_permission_id,
                &channel_id_str,
                &AccessLevel::View,
            )
            .await
        {
            tracing::warn!(error=?e, "channel share permission may already exist, continuing");
        }

        let mut tx = self.inner.begin().await?;
        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            &macro_uuid::string_to_uuid(item_id).unwrap(),
            model_entity::EntityType::from_str(item_type).unwrap(),
            &channel_id.to_string(),
            entity_access_db_utils::EntityAccessSourceType::Channel,
            AccessLevel::View,
        )
        .await?;
        tx.commit().await?;

        Ok(())
    }

    /// Fetch an email link by its ID.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_email_link(
        &self,
        link_id: uuid::Uuid,
    ) -> anyhow::Result<Option<service::link::Link>> {
        let result = email_db_client::links::get::fetch_link_by_id(&self.inner, link_id).await?;
        Ok(result)
    }

    /// Upsert an email link (connects a user to an email provider).
    #[tracing::instrument(skip(self), err)]
    pub async fn upsert_email_link(
        &self,
        link: service::link::Link,
    ) -> anyhow::Result<service::link::Link> {
        let result = email_db_client::links::insert::upsert_link(&self.inner, link).await?;
        Ok(result)
    }

    /// Insert or update email labels for a link.
    #[tracing::instrument(skip(self), err)]
    pub async fn insert_email_labels(
        &self,
        labels: Vec<service::label::Label>,
    ) -> anyhow::Result<()> {
        email_db_client::labels::insert::insert_or_update_labels(&self.inner, labels).await
    }

    /// Insert an email thread with all its messages, contacts, recipients, and labels.
    #[tracing::instrument(skip(self), err)]
    pub async fn insert_email_thread(
        &self,
        thread: service::thread::Thread,
        link_id: uuid::Uuid,
    ) -> anyhow::Result<uuid::Uuid> {
        let id = email_db_client::threads::insert::insert_thread_and_messages(
            &self.inner,
            thread,
            link_id,
        )
        .await?;
        Ok(id)
    }
}
