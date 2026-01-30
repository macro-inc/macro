mod client;
pub use client::ChannelClient;
use comms_service_client::CommsServiceClient;
use sqlx::{Pool, Postgres};

use crate::client::ScribeClient;
use std::sync::Arc;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    /// Configure the channel client with both HTTP client and database pool for internal operations
    pub fn with_channel_client_and_db<T: Into<Arc<CommsServiceClient>>>(
        self,
        channel_client: T,
        db: Pool<Postgres>,
    ) -> ScribeClient<D, ChannelClient, A, E, S> {
        let client = ChannelClient::new_with_db(channel_client.into(), db);
        ScribeClient {
            document: self.document,
            channel: client,
            chat: self.chat,
            email: self.email,
            static_file: self.static_file,
        }
    }
}
