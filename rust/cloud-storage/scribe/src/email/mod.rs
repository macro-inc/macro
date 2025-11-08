mod client;
pub use client::EmailClient;

use crate::client::ScribeClient;
use email_service_client::EmailServiceClient;
use std::sync::Arc;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    pub fn with_email_client<T: Into<Arc<EmailServiceClient>>>(
        self,
        email: T,
    ) -> ScribeClient<D, C, A, EmailClient, S> {
        let client = EmailClient::new(email.into());
        ScribeClient {
            document: self.document,
            channel: self.channel,
            chat: self.chat,
            email: client,
            static_file: self.static_file,
        }
    }
}
