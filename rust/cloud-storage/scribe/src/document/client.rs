use super::fetcher::NewDocumentFetcher;
use document_storage_service_client::DocumentStorageServiceClient;
use lexical_client::LexicalClient;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

#[derive(Clone)]
pub struct DocumentClient {
    pub dss_client: Arc<DocumentStorageServiceClient>,
    pub sync_service_client: Arc<SyncServiceClient>,
    pub lexical_client: Arc<LexicalClient>,
}

impl DocumentClient {
    pub fn builder() -> NewDocumentClientBuilder {
        NewDocumentClientBuilder::new()
    }

    pub fn new(
        dss_client: Arc<DocumentStorageServiceClient>,
        sync_service_client: Arc<SyncServiceClient>,
        lexical_client: Arc<LexicalClient>,
    ) -> Self {
        Self {
            dss_client,
            sync_service_client,
            lexical_client,
        }
    }
}

impl DocumentClient {
    pub fn fetch<T: Into<String>>(&self, document_id: T) -> NewDocumentFetcher {
        NewDocumentFetcher::new(
            self.dss_client.clone(),
            self.sync_service_client.clone(),
            self.lexical_client.clone(),
            document_id.into(),
        )
    }

    /// Create a fetcher with JWT authentication for external API calls
    pub fn fetch_with_auth<T: Into<String>>(
        &self,
        document_id: T,
        jwt_token: String,
    ) -> NewDocumentFetcher {
        NewDocumentFetcher::new(
            self.dss_client.clone(),
            self.sync_service_client.clone(),
            self.lexical_client.clone(),
            document_id.into(),
        )
        .with_jwt_token(jwt_token)
    }
}

// --- builder --- //
// slight insanity but its good ong
pub type NewDocumentClientBuilder = DocumentClientBuilder<(), (), ()>;
impl Default for NewDocumentClientBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl NewDocumentClientBuilder {
    pub fn new() -> Self {
        Self {
            dss_client: (),
            lexical_client: (),
            sync_service_client: (),
        }
    }
}

pub struct DocumentClientBuilder<A, B, C> {
    pub dss_client: A,
    pub sync_service_client: B,
    pub lexical_client: C,
}

impl<A, B, C> DocumentClientBuilder<A, B, C> {
    pub fn with_dss_client<T: Into<Arc<DocumentStorageServiceClient>>>(
        self,
        dss_client: T,
    ) -> DocumentClientBuilder<Arc<DocumentStorageServiceClient>, B, C> {
        DocumentClientBuilder {
            dss_client: dss_client.into(),
            lexical_client: self.lexical_client,
            sync_service_client: self.sync_service_client,
        }
    }
}

impl<A, B, C> DocumentClientBuilder<A, B, C> {
    pub fn with_sync_service_client<T: Into<Arc<SyncServiceClient>>>(
        self,
        sync_service_client: T,
    ) -> DocumentClientBuilder<A, Arc<SyncServiceClient>, C> {
        DocumentClientBuilder {
            dss_client: self.dss_client,
            lexical_client: self.lexical_client,
            sync_service_client: sync_service_client.into(),
        }
    }
}

impl<A, B, C> DocumentClientBuilder<A, B, C> {
    pub fn with_lexical_client<T: Into<Arc<LexicalClient>>>(
        self,
        lexical_client: T,
    ) -> DocumentClientBuilder<A, B, Arc<LexicalClient>> {
        DocumentClientBuilder {
            dss_client: self.dss_client,
            lexical_client: lexical_client.into(),
            sync_service_client: self.sync_service_client,
        }
    }
}

impl
    DocumentClientBuilder<
        Arc<DocumentStorageServiceClient>,
        Arc<SyncServiceClient>,
        Arc<LexicalClient>,
    >
{
    pub fn build(self) -> DocumentClient {
        DocumentClient {
            dss_client: self.dss_client,
            sync_service_client: self.sync_service_client,
            lexical_client: self.lexical_client,
        }
    }
}
// --- end builder ---//
