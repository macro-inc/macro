mod client;
pub use client::DcsClient;
use document_cognition_service_client::DocumentCognitionServiceClient;
use std::sync::Arc;

use crate::client::ScribeClient;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    pub fn with_dcs_client<T: Into<Arc<DocumentCognitionServiceClient>>>(
        self,
        chat_client: T,
    ) -> ScribeClient<D, C, DcsClient, E, S> {
        let dcs_client = DcsClient::new(chat_client.into());
        ScribeClient {
            channel: self.channel,
            chat: dcs_client,
            document: self.document,
            email: self.email,
            static_file: self.static_file,
        }
    }
}
