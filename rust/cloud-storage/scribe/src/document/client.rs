use super::fetcher::NewDocumentFetcher;
use super::project::ProjectFetcher;
use document_storage_service_client::DocumentStorageServiceClient;
use lexical_client::LexicalClient;
use sqlx::{Pool, Postgres};
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

#[derive(Clone)]
pub struct DocumentClient {
    pub dss_client: Arc<DocumentStorageServiceClient>,
    pub sync_service_client: Arc<SyncServiceClient>,
    pub lexical_client: Arc<LexicalClient>,
    pub macro_db: Arc<Pool<Postgres>>,
}

impl DocumentClient {
    pub fn builder() -> NewDocumentClientBuilder {
        NewDocumentClientBuilder::new()
    }

    pub fn new(
        dss_client: Arc<DocumentStorageServiceClient>,
        sync_service_client: Arc<SyncServiceClient>,
        lexical_client: Arc<LexicalClient>,
        macro_db: Arc<Pool<Postgres>>,
    ) -> Self {
        Self {
            dss_client,
            sync_service_client,
            lexical_client,
            macro_db,
        }
    }
}

impl DocumentClient {
    pub fn fetch<T: Into<String>>(&self, document_id: T) -> NewDocumentFetcher {
        NewDocumentFetcher::new(
            self.dss_client.clone(),
            self.sync_service_client.clone(),
            self.lexical_client.clone(),
            self.macro_db.clone(),
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
            self.macro_db.clone(),
            document_id.into(),
        )
        .with_jwt_token(jwt_token)
    }

    pub fn fetch_project(&self, id: String) -> ProjectFetcher<()> {
        ProjectFetcher::new(id)
    }

    /// Get the database pool for direct DB access
    pub fn db(&self) -> &Pool<Postgres> {
        &self.macro_db
    }
}

// --- builder --- //
// slight insanity but its good ong
pub type NewDocumentClientBuilder = DocumentClientBuilder<(), (), (), ()>;
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
            macro_db: (),
        }
    }
}

pub struct DocumentClientBuilder<A, B, C, D> {
    pub dss_client: A,
    pub sync_service_client: B,
    pub lexical_client: C,
    pub macro_db: D,
}

impl<A, B, C, D> DocumentClientBuilder<A, B, C, D> {
    pub fn with_dss_client<T: Into<Arc<DocumentStorageServiceClient>>>(
        self,
        dss_client: T,
    ) -> DocumentClientBuilder<Arc<DocumentStorageServiceClient>, B, C, D> {
        DocumentClientBuilder {
            dss_client: dss_client.into(),
            lexical_client: self.lexical_client,
            sync_service_client: self.sync_service_client,
            macro_db: self.macro_db,
        }
    }
}

impl<A, B, C, D> DocumentClientBuilder<A, B, C, D> {
    pub fn with_sync_service_client<T: Into<Arc<SyncServiceClient>>>(
        self,
        sync_service_client: T,
    ) -> DocumentClientBuilder<A, Arc<SyncServiceClient>, C, D> {
        DocumentClientBuilder {
            dss_client: self.dss_client,
            lexical_client: self.lexical_client,
            sync_service_client: sync_service_client.into(),
            macro_db: self.macro_db,
        }
    }
}

impl<A, B, C, D> DocumentClientBuilder<A, B, C, D> {
    pub fn with_lexical_client<T: Into<Arc<LexicalClient>>>(
        self,
        lexical_client: T,
    ) -> DocumentClientBuilder<A, B, Arc<LexicalClient>, D> {
        DocumentClientBuilder {
            dss_client: self.dss_client,
            lexical_client: lexical_client.into(),
            sync_service_client: self.sync_service_client,
            macro_db: self.macro_db,
        }
    }
}

impl<A, B, C, D> DocumentClientBuilder<A, B, C, D> {
    pub fn with_macro_db<T: Into<Arc<Pool<Postgres>>>>(
        self,
        macro_db: T,
    ) -> DocumentClientBuilder<A, B, C, Arc<Pool<Postgres>>> {
        DocumentClientBuilder {
            dss_client: self.dss_client,
            lexical_client: self.lexical_client,
            sync_service_client: self.sync_service_client,
            macro_db: macro_db.into(),
        }
    }
}

impl
    DocumentClientBuilder<
        Arc<DocumentStorageServiceClient>,
        Arc<SyncServiceClient>,
        Arc<LexicalClient>,
        Arc<Pool<Postgres>>,
    >
{
    pub fn build(self) -> DocumentClient {
        DocumentClient {
            dss_client: self.dss_client,
            sync_service_client: self.sync_service_client,
            lexical_client: self.lexical_client,
            macro_db: self.macro_db,
        }
    }
}
// --- end builder ---//
