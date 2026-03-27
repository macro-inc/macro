mod client;
pub use client::ChannelClient;
use sqlx::{Pool, Postgres};

use crate::client::ScribeClient;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    /// Configure the channel client with a database pool for direct DB operations
    pub fn with_channel_client(
        self,
        db: Pool<Postgres>,
    ) -> ScribeClient<D, ChannelClient, A, E, S> {
        let client = ChannelClient::new(db);
        ScribeClient {
            document: self.document,
            channel: client,
            chat: self.chat,
            email: self.email,
            static_file: self.static_file,
        }
    }
}
