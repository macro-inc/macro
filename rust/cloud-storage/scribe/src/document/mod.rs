use crate::client::ScribeClient;
mod client;
mod fetcher;
pub mod types;

pub use client::DocumentClient;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    pub fn with_document_client(
        self,
        document_client: DocumentClient,
    ) -> ScribeClient<DocumentClient, C, A, E, S> {
        ScribeClient {
            document: document_client,
            channel: self.channel,
            chat: self.chat,
            email: self.email,
            static_file: self.static_file,
        }
    }
}
