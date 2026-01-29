mod client;
pub use client::ChannelClient;

use crate::client::ScribeClient;
use sqlx::PgPool;
use std::sync::Arc;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    pub fn with_comms_db<T: Into<Arc<PgPool>>>(
        self,
        db: T,
    ) -> ScribeClient<D, ChannelClient, A, E, S> {
        let client = ChannelClient::new(db.into());
        ScribeClient {
            document: self.document,
            channel: client,
            chat: self.chat,
            email: self.email,
            static_file: self.static_file,
        }
    }
}
