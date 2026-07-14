use lexical_client::LexicalClient;
use macro_env_var::{env_var, maybe_env_vars};
use sync_service_client::SyncServiceClient;

use crate::service::{auth::Auth, db::Db, s3::S3};

env_var! {
    pub struct EnvVars {
        /// macrodb url
        pub DatabaseUrl,
        /// fusionauth url
        pub FusionauthBaseUrl,
        /// fusionauth api key
        pub FusionauthApiKeySecretKey,
        /// fusionauth tenant id
        pub FusionauthTenantId,
        /// fusionauth client id
        pub FusionauthClientId,
        /// fusionauth client secret key
        pub FusionauthClientSecretKey,
        /// Fusionauth oauth redirect uri
        pub FusionauthOauthRedirectUri,
        /// The document storage bucket
        pub DocumentStorageBucket,
    }
}

maybe_env_vars! {
    /// sync-service base url (markdown document content lives there)
    pub struct SyncServiceUrl;
    /// lexical-service base url (markdown -> loro snapshot conversion)
    pub struct LexicalServiceUrl;
    /// internal auth key shared by sync/lexical locally
    pub struct InternalApiSecretKey;
    /// frontend dev server port, for the per-persona URLs apply prints
    pub struct FrontendPort;
}

/// Clients for initializing native markdown document content.
pub struct DocContentClients {
    /// Converts markdown to a loro snapshot.
    pub lexical: LexicalClient,
    /// Boots the document's durable object from a snapshot.
    pub sync: SyncServiceClient,
}

impl DocContentClients {
    /// Build the clients when the optional env vars are present.
    pub fn from_env() -> Option<Self> {
        let sync_url = SyncServiceUrl::new()?;
        let lexical_url = LexicalServiceUrl::new()?;
        let auth_key = InternalApiSecretKey::new()
            .map(|key| key.to_string())
            .unwrap_or_else(|| "local".to_string());
        Some(Self {
            lexical: LexicalClient::new(auth_key.clone(), lexical_url.to_string()),
            sync: SyncServiceClient::new(auth_key, sync_url.to_string()),
        })
    }
}

/// The context containing everything we need to use in the CLI
pub struct SeedCliContext {
    /// Database connection to macrodb
    pub db: Db,
    /// Fusionauth client
    pub fusionauth_client: Auth,
    /// S3 client
    pub s3: S3,
    /// Markdown content clients; absent when sync/lexical env vars are unset.
    pub doc_content: Option<DocContentClients>,
}
