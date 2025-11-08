use crate::{
    OpensearchClient, Result, delete,
    search::{
        self,
        channels::{ChannelMessageSearchResponse, search_channel_messages},
    },
    upsert::{self, channel_message::UpsertChannelMessageArgs},
};

impl OpensearchClient {
    /// Upserts a channel message into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_channel_message(
        &self,
        upsert_channel_message_args: &UpsertChannelMessageArgs,
    ) -> Result<()> {
        upsert::channel_message::upsert_channel_message(&self.inner, upsert_channel_message_args)
            .await
    }

    /// Deletes a channel from the opensearch chat index
    /// This will remove all messages for a given channel
    #[tracing::instrument(skip(self))]
    pub async fn delete_channel(&self, channel_id: &str) -> Result<()> {
        delete::channel::delete_channel_by_id(&self.inner, channel_id).await
    }

    /// Deletes a channel message from the opensearch channel index
    /// This removes a specific message from a channel
    #[tracing::instrument(skip(self))]
    pub async fn delete_channel_message(
        &self,
        channel_id: &str,
        channel_message_id: &str,
    ) -> Result<()> {
        delete::channel::delete_channel_message_by_id(&self.inner, channel_id, channel_message_id)
            .await
    }

    /// Searches for channel messages in the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn search_channel_messages(
        &self,
        args: search::channels::ChannelMessageSearchArgs,
    ) -> Result<Vec<ChannelMessageSearchResponse>> {
        search_channel_messages(&self.inner, args).await
    }
}
