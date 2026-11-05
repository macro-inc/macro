//! The documents domain and the document permission token, as artifacts use
//! them.

#[cfg(test)]
mod test;

use std::sync::Arc;

use artifacts::domain::models::{ArtifactError, MintedToken, Publisher, Viewer};
use artifacts::domain::ports::{
    ArtifactCanvases, ArtifactDocuments, ArtifactNotifier, CanvasDocumentNode,
    CreatedArtifactDocument, VerifiedToken, ViewTokens,
};
use channels::domain::models::CreateEntityMentionOptions;
use channels::domain::ports::ChannelService as _;
use connection_gateway_client::client::ConnectionGatewayClient;
use documents_hex::domain::canvas::{CanvasDocumentEmbed, CanvasEmbedder};
use documents_hex::domain::create::NewDocumentMetadata;
use documents_hex::domain::models::DocumentError;

use documents_hex::domain::ports::DocumentService as _;
use documents_hex::inbound::axum_router::DefaultDocumentCreator;
use documents_hex::outbound::editing_worker_client::ReqwestEditingWorkerClient;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_sync_service_jwt::artifact_content::{
    ArtifactContentClaims, decode_artifact_content, encode_artifact_content,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::DocumentBasic;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use crate::api::context::{DocumentService, DssChannelService};

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

/// View tokens are artifact content tokens, signed with the document
/// permission secret but with an issuer and audience no document grant
/// consumer accepts, so a page that reads its URL holds nothing usable
/// elsewhere.
pub struct ArtifactContentViewTokens {
    secret: String,
}

impl ArtifactContentViewTokens {
    /// Tokens signed with `secret`.
    pub fn new(secret: impl Into<String>) -> Self {
        Self {
            secret: secret.into(),
        }
    }
}

impl ViewTokens for ArtifactContentViewTokens {
    fn mint(&self, viewer: &Viewer, document_id: &str) -> Result<MintedToken, ArtifactError> {
        let now = chrono::Utc::now();
        let now_secs = u64::try_from(now.timestamp())
            .map_err(|error| ArtifactError::Internal(anyhow::Error::new(error)))?;
        let claims = ArtifactContentClaims::new(
            document_id.to_string(),
            viewer.user_id.clone(),
            viewer.actor.clone(),
            now_secs,
        );
        let expires_at = i64::try_from(claims.exp)
            .ok()
            .and_then(|exp| chrono::DateTime::from_timestamp(exp, 0))
            .ok_or_else(|| ArtifactError::Internal(anyhow::anyhow!("token expiry out of range")))?;
        let token = encode_artifact_content(&claims, &self.secret)
            .map_err(|error| ArtifactError::Internal(anyhow::Error::new(error)))?;

        Ok(MintedToken { token, expires_at })
    }

    fn verify(&self, token: &str) -> Option<VerifiedToken> {
        decode_artifact_content(token, &self.secret)
            .ok()
            .map(|claims| VerifiedToken {
                document_id: claims.document_id,
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

/// Places artifacts on canvases: the reference is the entity mention the
/// canvas UI records through `POST /channels/mentions`, and the node goes
/// through the editing worker's internal canvas embed request.
pub(crate) struct CanvasesForArtifacts {
    channels: Arc<DssChannelService>,
    embedder: CanvasEmbedder<DocumentService, ReqwestEditingWorkerClient>,
}

impl CanvasesForArtifacts {
    /// Adapter over the host's channel service and canvas embedder.
    pub(crate) fn new(
        channels: Arc<DssChannelService>,
        embedder: CanvasEmbedder<DocumentService, ReqwestEditingWorkerClient>,
    ) -> Self {
        Self { channels, embedder }
    }
}

impl CanvasesForArtifacts {
    async fn recorded(&self, mention_id: uuid::Uuid) -> Result<bool, ArtifactError> {
        Ok(self
            .channels
            .get_entity_mention(mention_id)
            .await
            .map_err(|error| ArtifactError::Internal(anyhow::Error::new(error)))?
            .is_some())
    }
}

impl ArtifactCanvases for CanvasesForArtifacts {
    async fn record_reference(
        &self,
        mention_id: uuid::Uuid,
        canvas_id: &str,
        document_id: &str,
        user_id: &str,
    ) -> Result<(), ArtifactError> {
        if self.recorded(mention_id).await? {
            return Ok(());
        }
        let created = self
            .channels
            .create_entity_mention(CreateEntityMentionOptions {
                id: Some(mention_id),
                source_entity_type: "document".to_string(),
                source_entity_id: canvas_id.to_string(),
                entity_type: "document".to_string(),
                entity_id: document_id.to_string(),
                user_id: Some(user_id.to_string()),
            })
            .await;
        match created {
            Ok(_) => Ok(()),
            // A concurrent retry recorded it first.
            Err(_) if self.recorded(mention_id).await? => Ok(()),
            Err(error) => Err(ArtifactError::Internal(anyhow::Error::new(error))),
        }
    }

    async fn embed(
        &self,
        canvas: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        node: CanvasDocumentNode,
    ) -> Result<(), ArtifactError> {
        let user = MacroUserIdStr::try_from(publisher.user_id.clone()).map_err(|error| {
            ArtifactError::Internal(anyhow::anyhow!("invalid user id: {error}"))
        })?;
        self.embedder
            .embed_document(
                canvas,
                &user,
                publisher.agent.as_deref(),
                CanvasDocumentEmbed {
                    item_id: node.item_id,
                    document_id: node.document_id,
                    name: node.name,
                    file_type: node.file_type,
                    subpath: node.subpath,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                    mention_id: node.mention_id,
                },
            )
            .await
            .map_err(ArtifactError::Internal)
    }
}
