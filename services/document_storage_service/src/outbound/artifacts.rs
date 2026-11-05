//! The documents domain and the document permission token, as artifacts use
//! them.

#[cfg(test)]
mod test;

use std::sync::Arc;

use artifacts::domain::models::{ArtifactError, MintedToken, Viewer};
use artifacts::domain::ports::{
    ArtifactDocuments, ArtifactNotifier, CreatedArtifactDocument, VerifiedToken, ViewTokens,
};
use connection_gateway_client::client::ConnectionGatewayClient;
use documents_hex::domain::create::NewDocumentMetadata;
use documents_hex::domain::models::DocumentError;
use documents_hex::domain::permission_token::{decode_permission_token, encode_permission_token};
use documents_hex::domain::ports::DocumentService as _;
use documents_hex::inbound::axum_router::DefaultDocumentCreator;
use entity_access::domain::models::AccessLevel;
use macro_sync_service_jwt::{DocumentPermissionToken, TOKEN_TTL_SECS};
use model::document::DocumentBasic;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use crate::api::context::DocumentService;

fn artifact_error(error: DocumentError) -> ArtifactError {
    match error {
        DocumentError::NotFound(message) => ArtifactError::NotFound(message),
        DocumentError::Unauthorized => {
            ArtifactError::Forbidden("not allowed to create this artifact".to_string())
        }
        DocumentError::BadRequest(message) => ArtifactError::BadRequest(message),
        DocumentError::NameTooLong { max } => {
            ArtifactError::BadRequest(format!("names are at most {max} characters"))
        }
        error => ArtifactError::Internal(anyhow::Error::new(error)),
    }
}

/// Creates artifact documents through the documents domain's creation use
/// case, so they get the owner, folder and share defaults of every created
/// document.
pub(crate) struct DocumentsForArtifacts {
    creator: DefaultDocumentCreator<DocumentService>,
    documents: Arc<DocumentService>,
}

impl DocumentsForArtifacts {
    /// Adapter over the host's document creator and service.
    pub(crate) fn new(
        creator: DefaultDocumentCreator<DocumentService>,
        documents: Arc<DocumentService>,
    ) -> Self {
        Self { creator, documents }
    }
}

impl ArtifactDocuments for DocumentsForArtifacts {
    async fn create(
        &self,
        principal: &CreationPrincipal,
        name: String,
        project_id: Option<uuid::Uuid>,
    ) -> Result<CreatedArtifactDocument, ArtifactError> {
        let mut metadata = NewDocumentMetadata::builder(name);
        if let Some(project_id) = project_id {
            metadata = metadata.project_id(project_id);
        }

        let created = self
            .creator
            .create_artifact(principal, metadata.build())
            .await
            .map_err(artifact_error)?;
        let metadata = &created
            .response()
            .document_response
            .document_metadata
            .metadata;

        Ok(CreatedArtifactDocument {
            document_id: metadata.document_id.clone(),
            name: metadata.document_name.clone(),
            owner: metadata.owner.to_string(),
        })
    }

    async fn discard(&self, document_id: &str) {
        self.creator.discard_created_document(document_id).await;
    }

    async fn load(&self, document_id: &str) -> Result<Option<DocumentBasic>, ArtifactError> {
        match self
            .documents
            .internal_get_basic_document(document_id)
            .await
        {
            Ok(document) => Ok(Some(document)),
            Err(DocumentError::NotFound(_)) => Ok(None),
            Err(error) => Err(artifact_error(error)),
        }
    }
}

/// View tokens are document permission tokens, signed with the secret that
/// signs every other one.
pub struct PermissionTokenViewTokens {
    secret: String,
}

impl PermissionTokenViewTokens {
    /// Tokens signed with `secret`.
    pub fn new(secret: impl Into<String>) -> Self {
        Self {
            secret: secret.into(),
        }
    }
}

impl ViewTokens for PermissionTokenViewTokens {
    fn mint(
        &self,
        viewer: &Viewer,
        document_id: &str,
        access_level: AccessLevel,
    ) -> Result<MintedToken, ArtifactError> {
        let expires_at = chrono::Utc::now() + chrono::Duration::seconds(TOKEN_TTL_SECS as i64);
        let token = encode_permission_token(
            viewer.user_id.clone(),
            document_id.to_string(),
            access_level,
            &self.secret,
            viewer.actor.clone(),
        )
        .map_err(|error| ArtifactError::Internal(anyhow::Error::new(error)))?;

        Ok(MintedToken {
            token: token.into_inner(),
            expires_at,
        })
    }

    fn verify(&self, token: &str) -> Option<VerifiedToken> {
        let token = DocumentPermissionToken::from(token.to_string());
        decode_permission_token(&token, &self.secret)
            .ok()
            .map(|claims| VerifiedToken {
                document_id: claims.document_id().to_string(),
            })
    }
}

/// Sends `artifact_published` to everyone subscribed to the artifact
/// document, through the connection gateway like other document updates.
pub struct ConnectionGatewayArtifactNotifier {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayArtifactNotifier {
    /// Notifier over the host's connection gateway client.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

impl ArtifactNotifier for ConnectionGatewayArtifactNotifier {
    #[tracing::instrument(name = "artifact.notify_published", skip(self))]
    async fn published(&self, document_id: &str, version: i32) {
        if cfg!(not(feature = "connection_gateway")) {
            return;
        }

        let sent = self
            .client
            .batch_send_message(
                "artifact_published".to_string(),
                serde_json::json!({ "documentId": document_id, "version": version }),
                vec![EntityType::Document.with_entity_str(document_id)],
            )
            .await;
        if let Err(error) = sent {
            tracing::warn!(error = ?error, "failed to send artifact_published");
        }
    }
}
