mod client;
pub use client::ChannelClient;
use comms_service_client::CommsServiceClient;

use crate::client::ScribeClient;
use std::sync::Arc;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    pub fn with_channel_client<T: Into<Arc<CommsServiceClient>>>(
        self,
        channel_client: T,
    ) -> ScribeClient<D, ChannelClient, A, E, S> {
        let client = ChannelClient::new(channel_client.into());
        ScribeClient {
            document: self.document,
            channel: client,
            chat: self.chat,
            email: self.email,
            static_file: self.static_file,
        }
    }
}
