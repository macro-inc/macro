use crate::{
    OpensearchClient, Result, delete,
    retry::resend_on_lost_connection,
    search::{
        self,
        channels::{ChannelSearchArgs, ChannelSearchResults},
    },
    upsert::{self, channel_message::UpsertChannelMessageArgs},
};

impl OpensearchClient {
    /// Performs a channel content search.
    #[tracing::instrument(skip(self, args), err)]
    pub async fn search_channel(&self, args: ChannelSearchArgs) -> Result<ChannelSearchResults> {
        resend_on_lost_connection(|| search::channels::search_channel(&self.inner, args.clone()))
            .await
    }
}

impl OpensearchClient {
    /// Upserts a channel message into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_channel_message(
        &self,
        upsert_channel_message_args: &UpsertChannelMessageArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::channel_message::upsert_channel_message(
                &self.inner,
                upsert_channel_message_args,
                index_override,
            )
        })
        .await
    }

    /// Deletes a channel from the opensearch chat index
    /// This will remove all messages for a given channel
    #[tracing::instrument(skip(self))]
    pub async fn delete_channel(
        &self,
        channel_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::channel::delete_channel_by_id(&self.inner, channel_id, index_override)
        })
        .await
    }

    /// Deletes a channel message from the opensearch channel index
    /// This removes a specific message from a channel
    #[tracing::instrument(skip(self))]
    pub async fn delete_channel_message(
        &self,
        channel_id: &str,
        channel_message_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::channel::delete_channel_message_by_id(
                &self.inner,
                channel_id,
                channel_message_id,
                index_override,
            )
        })
        .await
    }
}
