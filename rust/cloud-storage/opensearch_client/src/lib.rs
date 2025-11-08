pub mod date_format;
pub mod delete;
pub mod error;
pub mod get_document;
pub mod search;
pub mod search_on;
pub mod upsert;

pub use search_on::SearchOn;

pub mod channel_message;
pub mod chat;
pub mod document;
pub mod email;
pub mod project;

pub type Result<T> = std::result::Result<T, error::OpensearchClientError>;

use opensearch::{
    OpenSearch,
    auth::Credentials,
    cert::CertificateValidation,
    http::{
        Url,
        transport::{SingleNodeConnectionPool, TransportBuilder},
    },
    indices::{IndicesCreateParts, IndicesExistsParts},
};

pub static DOCUMENTS_INDEX: &str = "documents";
pub static CHAT_INDEX: &str = "chats";
pub static EMAIL_INDEX: &str = "emails";
pub static CHANNEL_INDEX: &str = "channels";
pub static PROJECT_INDEX: &str = "projects";

#[derive(Clone, Debug)]
pub struct OpensearchClient {
    /// The opensearch client used to interact with opensearch api
    inner: opensearch::OpenSearch,
}

impl OpensearchClient {
    pub fn new(
        opensearch_url: String,
        opensearch_username: String,
        opensearch_password: String,
    ) -> anyhow::Result<Self> {
        let url = Url::parse(&opensearch_url)?;
        let credentials = Credentials::Basic(opensearch_username, opensearch_password);
        let conn_pool = SingleNodeConnectionPool::new(url);

        let cert_validation = if opensearch_url.contains("https://localhost") {
            CertificateValidation::None
        } else {
            CertificateValidation::Default
        };
        let transport = TransportBuilder::new(conn_pool)
            .auth(credentials)
            .disable_proxy()
            .cert_validation(cert_validation)
            .build()?;
        let client = OpenSearch::new(transport);
        Ok(Self { inner: client })
    }

    pub async fn health(&self) -> anyhow::Result<()> {
        let response = self.inner.cat().health().send().await?;
        let status = response.status_code();

        if status != 200 {
            return Err(anyhow::anyhow!(
                "Health check failed with status code {status}"
            ));
        }

        Ok(())
    }

    /// Checks if the index exists, if not it will create the index with the provided body
    /// This should not be used unless you know what you are doing.
    #[tracing::instrument(skip(self, index_body))]
    pub async fn ensure_index_exists(
        &self,
        index_name: &str,
        index_body: serde_json::Value,
    ) -> anyhow::Result<()> {
        // Check if index exists
        let exists = self
            .inner
            .indices()
            .exists(IndicesExistsParts::Index(&[index_name]))
            .send()
            .await?;

        let exists = exists.status_code().is_success();

        tracing::trace!(exists=?exists, "checking if index exists");

        if !exists {
            tracing::info!(index_body=?index_body, "index does not exist, creating...");
            // Create index with mappings
            let response = self
                .inner
                .indices()
                .create(IndicesCreateParts::Index(index_name))
                .body(index_body)
                .send()
                .await?;

            if !response.status_code().is_success() {
                return Err(anyhow::anyhow!("error creating index: {response:?}"));
            }
        }

        Ok(())
    }
}
