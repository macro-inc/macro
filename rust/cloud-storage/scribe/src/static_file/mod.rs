use crate::client::ScribeClient;
mod client;
mod fetcher;
mod types;

pub use client::StaticFileClient;
pub use fetcher::{NewStaticFileFetcher, StaticFileFetcher};
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
pub use types::{StaticFileContent, StaticFileData};

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    pub fn with_static_file_client<T: Into<Arc<StaticFileServiceClient>>>(
        self,
        static_file: T,
    ) -> ScribeClient<D, C, A, E, StaticFileClient> {
        let client = StaticFileClient::new(static_file.into());
        ScribeClient {
            document: self.document,
            channel: self.channel,
            chat: self.chat,
            email: self.email,
            static_file: client,
        }
    }
}
