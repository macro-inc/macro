use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;

use crate::static_file::{NewStaticFileFetcher, StaticFileFetcher};

#[derive(Clone)]
pub struct StaticFileClient {
    inner: Arc<StaticFileServiceClient>,
}

impl StaticFileClient {
    pub fn new(inner: Arc<StaticFileServiceClient>) -> Self {
        Self { inner }
    }
}

impl StaticFileClient {
    /// Create a new static file fetcher for a given file ID
    pub fn fetch<T: Into<String>>(&self, file_id: T) -> NewStaticFileFetcher {
        StaticFileFetcher::new(self.inner.clone(), file_id.into())
    }
}
