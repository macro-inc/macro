//! The artifact service.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, RequiredPermission, ViewAccessLevel,
};
use model::document::DocumentBasic;
use model_owner::CreationPrincipal;
use tracing::field::Empty;

use super::manifest::{ManifestDraft, parse_content_type, parse_sha256};
use super::models::{
    Artifact, ArtifactError, ArtifactPath, ArtifactVersion, ArtifactVersionSummary, ContentOrigin,
    ContentRequest, ContentResponse, CreateArtifact, ENTRY_PATH, MAX_CANVAS_COORDINATE,
    MAX_CANVAS_SIZE, MAX_FILE_BYTES, MAX_FILES, Manifest, PlaceArtifact, Placement, PublishVersion,
    Publisher, Sha256, UploadInput, UploadTarget, ViewUrl, ViewUrlRequest,
};
use super::ports::{
    ArtifactCanvases, ArtifactDocuments, ArtifactNotifier, ArtifactObjectStore, ArtifactRepository,
    ArtifactService, CanvasDocumentNode, NewVersion, ViewTokens,
};

/// The file type documents of artifacts carry.
const ARTIFACT_FILE_TYPE: &str = "artifact";
/// Namespace of the mention ids derived from canvas item ids (`uuid` v5).
const CANVAS_REFERENCE_NAMESPACE: &[u8] = b"macro.artifact.canvas-reference";
/// The file type of canvases artifacts are placed on.
const CANVAS_FILE_TYPE: &str = "canvas";

/// The artifact service over its ports.
pub struct ArtifactServiceImpl<Repository, ObjectStore, Documents, Tokens, Notifier, Canvases> {
    repository: Repository,
    object_store: ObjectStore,
    documents: Documents,
    tokens: Tokens,
    notifier: Notifier,
    canvases: Canvases,
    origin: ContentOrigin,
}

impl<Repository, ObjectStore, Documents, Tokens, Notifier, Canvases>
    ArtifactServiceImpl<Repository, ObjectStore, Documents, Tokens, Notifier, Canvases>
{
    /// Assemble the service.
    pub fn new(
        repository: Repository,
        object_store: ObjectStore,
        documents: Documents,
        tokens: Tokens,
        notifier: Notifier,
        canvases: Canvases,
        origin: ContentOrigin,
    ) -> Self {
        Self {
            repository,
            object_store,
            documents,
            tokens,
            notifier,
            canvases,
            origin,
        }
    }
}

fn document_id_of<Permission: RequiredPermission>(
    receipt: &EntityAccessReceipt<Permission>,
) -> String {
    receipt.entity().entity_id.clone()
}

fn clean_message(message: Option<String>) -> Option<String> {
    message
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
}

impl<Repository, ObjectStore, Documents, Tokens, Notifier, Canvases>
    ArtifactServiceImpl<Repository, ObjectStore, Documents, Tokens, Notifier, Canvases>
where
    Repository: ArtifactRepository,
    ObjectStore: ArtifactObjectStore,
    Documents: ArtifactDocuments,
    Tokens: ViewTokens,
    Notifier: ArtifactNotifier,
    Canvases: ArtifactCanvases,
{
    /// Sizes of digests stored for the artifact: recorded by a version, or
    /// uploaded to the object store.
    async fn stored_sizes(
        &self,
        document_id: &str,
        digests: &HashSet<Sha256>,
    ) -> Result<HashMap<Sha256, u64>, ArtifactError> {
        let mut sizes = self.repository.recorded_sizes(document_id, digests).await?;

        let unrecorded: Vec<&Sha256> = digests
            .iter()
            .filter(|digest| !sizes.contains_key(*digest))
            .collect();
        let uploaded = futures::future::try_join_all(
            unrecorded
                .iter()
                .map(|digest| self.object_store.size(document_id, digest)),
        )
        .await?;

        for (digest, size) in unrecorded.into_iter().zip(uploaded) {
            if let Some(size) = size {
                sizes.insert(digest.clone(), size);
            }
        }

        Ok(sizes)
    }

    /// Insert `manifest` as version `number`. A taken number means another
    /// publish won the race.
    async fn insert_version(
        &self,
        document_id: &str,
        number: i32,
        manifest: Manifest,
        publisher: &Publisher,
        message: Option<String>,
    ) -> Result<ArtifactVersion, ArtifactError> {
        let inserted = self
            .repository
            .insert_version(NewVersion {
                document_id: document_id.to_string(),
                number,
                manifest,
                message,
                created_by: publisher.user_id.clone(),
                created_by_agent: publisher.agent.clone(),
            })
            .await?;

        match inserted {
            Some(version) => {
                self.notifier.published(document_id, version.number).await;
                Ok(version)
            }
            None => {
                let current = self
                    .repository
                    .current_version(document_id)
                    .await?
                    .map_or(0, |version| version.number);
                Err(ArtifactError::Conflict {
                    base: number - 1,
                    current,
                })
            }
        }
    }

    /// Store a draft's inline objects and insert it as version `number`.
    #[tracing::instrument(
        name = "artifact.publish",
        skip_all,
        fields(document_id, version = number, file_count, bytes_inline, bytes_reused),
        err
    )]
    async fn publish_draft(
        &self,
        document_id: &str,
        number: i32,
        draft: ManifestDraft,
        publisher: &Publisher,
        message: Option<String>,
    ) -> Result<ArtifactVersion, ArtifactError> {
        let span = tracing::Span::current();
        span.record("document_id", document_id);
        span.record("file_count", draft.files().len());

        let stored = self
            .stored_sizes(document_id, &draft.stored_digests())
            .await?;
        let (manifest, inline_objects) = draft.finish(&stored)?;

        let bytes_inline: u64 = inline_objects
            .iter()
            .map(|object| object.bytes.len() as u64)
            .sum();
        let bytes_reused: u64 = manifest
            .files
            .values()
            .filter(|file| stored.contains_key(&file.sha256))
            .map(|file| file.size)
            .sum();
        span.record("bytes_inline", bytes_inline);
        span.record("bytes_reused", bytes_reused);

        futures::future::try_join_all(inline_objects.into_iter().map(|object| async move {
            self.object_store
                .put(
                    document_id,
                    &object.sha256,
                    &object.content_type,
                    object.bytes,
                )
                .await
        }))
        .await?;

        self.insert_version(document_id, number, manifest, publisher, message)
            .await
    }

    async fn current_number(&self, document_id: &str) -> Result<i32, ArtifactError> {
        Ok(self
            .repository
            .current_version(document_id)
            .await?
            .map_or(0, |version| version.number))
    }
}

impl<Repository, ObjectStore, Documents, Tokens, Notifier, Canvases> ArtifactService
    for ArtifactServiceImpl<Repository, ObjectStore, Documents, Tokens, Notifier, Canvases>
where
    Repository: ArtifactRepository,
    ObjectStore: ArtifactObjectStore,
    Documents: ArtifactDocuments,
    Tokens: ViewTokens,
    Notifier: ArtifactNotifier,
    Canvases: ArtifactCanvases,
{
    async fn load_document(&self, document_id: &str) -> Result<DocumentBasic, ArtifactError> {
        let not_found = || ArtifactError::NotFound(format!("artifact {document_id:?} not found"));
        let document = self
            .documents
            .load(document_id)
            .await?
            .ok_or_else(not_found)?;

        if document.file_type.as_deref() != Some(ARTIFACT_FILE_TYPE) {
            return Err(not_found());
        }
        Ok(document)
    }

    #[tracing::instrument(name = "artifact.create", skip_all, fields(document_id = Empty), err)]
    async fn create(
        &self,
        principal: &CreationPrincipal,
        publisher: &Publisher,
        request: CreateArtifact,
    ) -> Result<Artifact, ArtifactError> {
        let name = request.name.trim().to_string();
        if name.is_empty() {
            return Err(ArtifactError::BadRequest(
                "an artifact needs a name".to_string(),
            ));
        }
        if request.files.iter().any(|file| file.content.is_none()) {
            return Err(ArtifactError::BadRequest(
                "every file of a new artifact must carry its content".to_string(),
            ));
        }
        let draft = if request.files.is_empty() {
            if !request.scenes.is_empty() {
                return Err(ArtifactError::BadRequest(
                    "scenes need files to point at".to_string(),
                ));
            }
            None
        } else {
            Some(ManifestDraft::parse(request.files, request.scenes)?)
        };

        let document = self
            .documents
            .create(principal, name, request.project_id)
            .await?;
        tracing::Span::current().record("document_id", document.document_id.as_str());

        let Some(draft) = draft else {
            return Ok(Artifact {
                document_id: document.document_id,
                name: document.name,
                owner: document.owner,
                current: None,
            });
        };

        let published = self
            .publish_draft(
                &document.document_id,
                1,
                draft,
                publisher,
                clean_message(request.message),
            )
            .await;

        match published {
            Ok(current) => Ok(Artifact {
                document_id: document.document_id,
                name: document.name,
                owner: document.owner,
                current: Some(current),
            }),
            Err(error) => {
                self.documents.discard(&document.document_id).await;
                Err(error)
            }
        }
    }

    #[tracing::instrument(name = "artifact.uploads", skip_all, fields(document_id = Empty, requested = files.len(), missing = Empty), err)]
    async fn uploads(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        files: Vec<UploadInput>,
    ) -> Result<Vec<UploadTarget>, ArtifactError> {
        let document_id = document_id_of(&receipt);
        tracing::Span::current().record("document_id", document_id.as_str());

        if files.len() > MAX_FILES {
            return Err(ArtifactError::BadRequest(format!(
                "a version holds at most {MAX_FILES} files"
            )));
        }

        let mut requested: Vec<(Sha256, u64, String)> = Vec::with_capacity(files.len());
        for file in files {
            let sha256 = parse_sha256(&file.sha256)?;
            let content_type = parse_content_type(&file.content_type)?;
            if file.size > MAX_FILE_BYTES {
                return Err(ArtifactError::BadRequest(format!(
                    "{} is larger than 16 MiB",
                    sha256.as_str()
                )));
            }
            if !requested.iter().any(|(digest, _, _)| *digest == sha256) {
                requested.push((sha256, file.size, content_type));
            }
        }

        let digests: HashSet<Sha256> = requested
            .iter()
            .map(|(digest, _, _)| digest.clone())
            .collect();
        let stored = self.stored_sizes(&document_id, &digests).await?;
        let missing: Vec<(Sha256, u64, String)> = requested
            .into_iter()
            .filter(|(digest, _, _)| !stored.contains_key(digest))
            .collect();
        tracing::Span::current().record("missing", missing.len());

        let presigned =
            futures::future::try_join_all(missing.iter().map(|(digest, size, content_type)| {
                self.object_store
                    .presign_put(&document_id, digest, *size, content_type)
            }))
            .await?;

        Ok(missing
            .into_iter()
            .zip(presigned)
            .map(|((sha256, _, _), upload)| UploadTarget {
                sha256,
                url: upload.url,
                headers: upload.headers,
            })
            .collect())
    }

    async fn publish(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        request: PublishVersion,
    ) -> Result<ArtifactVersion, ArtifactError> {
        let document_id = document_id_of(&receipt);

        let draft = ManifestDraft::parse(request.files, request.scenes)?;

        // A current number of 0 means nothing is published yet, so a base of 0
        // publishes version 1.
        let current = self.current_number(&document_id).await?;
        if let Some(base) = request.base_version
            && base != current
        {
            return Err(ArtifactError::Conflict { base, current });
        }

        self.publish_draft(
            &document_id,
            current + 1,
            draft,
            publisher,
            clean_message(request.message),
        )
        .await
    }

    async fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Artifact, ArtifactError> {
        let document_id = document_id_of(&receipt);
        let document = self.load_document(&document_id).await?;
        let current = self.repository.current_version(&document_id).await?;

        Ok(Artifact {
            document_id,
            name: document.document_name.clone(),
            owner: document.owner.to_string(),
            current,
        })
    }

    async fn versions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<ArtifactVersionSummary>, ArtifactError> {
        Ok(self.repository.versions(&document_id_of(&receipt)).await?)
    }

    async fn version(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        number: i32,
    ) -> Result<ArtifactVersion, ArtifactError> {
        self.repository
            .version(&document_id_of(&receipt), number)
            .await?
            .ok_or_else(|| ArtifactError::NotFound(format!("version {number} not found")))
    }

    #[tracing::instrument(name = "artifact.restore", skip_all, fields(document_id = Empty, restored = number), err)]
    async fn restore(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        number: i32,
    ) -> Result<ArtifactVersion, ArtifactError> {
        let document_id = document_id_of(&receipt);
        tracing::Span::current().record("document_id", document_id.as_str());

        let restored = self
            .repository
            .version(&document_id, number)
            .await?
            .ok_or_else(|| ArtifactError::NotFound(format!("version {number} not found")))?;
        let current = self.current_number(&document_id).await?;

        self.insert_version(
            &document_id,
            current + 1,
            restored.manifest,
            publisher,
            Some(format!("Restored version {number}")),
        )
        .await
    }

    #[tracing::instrument(name = "artifact.view_url", skip_all, fields(document_id = Empty, version = Empty, scene = Empty), err)]
    async fn view_url(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: ViewUrlRequest,
    ) -> Result<ViewUrl, ArtifactError> {
        let document_id = document_id_of(&receipt);
        let span = tracing::Span::current();
        span.record("document_id", document_id.as_str());

        let version = match request.version {
            Some(number) => self.repository.version(&document_id, number).await?,
            None => self.repository.current_version(&document_id).await?,
        }
        .ok_or_else(|| match request.version {
            Some(number) => ArtifactError::NotFound(format!("version {number} not found")),
            None => {
                ArtifactError::NotFound("the artifact has no published version yet".to_string())
            }
        })?;
        span.record("version", version.number);

        let path = match &request.scene {
            Some(scene_id) => {
                span.record("scene", scene_id.as_str());
                version
                    .manifest
                    .scenes
                    .iter()
                    .find(|scene| scene.id.as_str() == scene_id)
                    .map(|scene| scene.path.as_str().to_string())
                    .ok_or_else(|| {
                        ArtifactError::NotFound(format!("scene {scene_id:?} not found"))
                    })?
            }
            None => String::new(),
        };

        let minted = self.tokens.mint(&document_id)?;

        let encoded_path = path
            .split('/')
            .map(|segment| urlencoding::encode(segment).into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let theme = request
            .theme
            .map(|theme| format!("?theme={}", theme.as_str()))
            .unwrap_or_default();
        let origin = self.origin.for_document(&document_id);

        Ok(ViewUrl {
            url: format!(
                "{origin}/t/{}/v/{}/{encoded_path}{theme}",
                minted.token, version.number
            ),
            origin,
            version: version.number,
            expires_at: minted.expires_at,
        })
    }

    async fn load_canvas(&self, canvas_id: &str) -> Result<DocumentBasic, ArtifactError> {
        let canvas =
            self.documents.load(canvas_id).await?.ok_or_else(|| {
                ArtifactError::NotFound(format!("canvas {canvas_id:?} not found"))
            })?;

        if canvas.file_type.as_deref() != Some(CANVAS_FILE_TYPE) {
            return Err(ArtifactError::BadRequest(format!(
                "{canvas_id:?} is not a canvas"
            )));
        }
        Ok(canvas)
    }

    #[tracing::instrument(
        name = "canvas.embed_artifact",
        skip_all,
        fields(
            document_id = Empty,
            canvas_id = Empty,
            version = Empty,
            scene = request.scene.as_deref(),
            item_id = Empty,
        ),
        err
    )]
    async fn place(
        &self,
        artifact: EntityAccessReceipt<ViewAccessLevel>,
        canvas: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        request: PlaceArtifact,
    ) -> Result<Placement, ArtifactError> {
        let document_id = document_id_of(&artifact);
        let canvas_id = document_id_of(&canvas);
        let span = tracing::Span::current();
        span.record("document_id", document_id.as_str());
        span.record("canvas_id", canvas_id.as_str());

        let coordinates_valid = [request.x, request.y]
            .iter()
            .all(|value| value.is_finite() && value.abs() <= MAX_CANVAS_COORDINATE);
        let size_valid = [request.width, request.height]
            .iter()
            .all(|value| value.is_finite() && *value > 0.0 && *value <= MAX_CANVAS_SIZE);
        if !coordinates_valid || !size_valid {
            return Err(ArtifactError::BadRequest(format!(
                "x and y must be within {MAX_CANVAS_COORDINATE} of the origin, and width and height positive and at most {MAX_CANVAS_SIZE}"
            )));
        }

        let current = self
            .repository
            .current_version(&document_id)
            .await?
            .ok_or_else(|| {
                ArtifactError::NotFound("the artifact has no published version yet".to_string())
            })?;
        span.record("version", current.number);
        if let Some(scene) = &request.scene
            && !current
                .manifest
                .scenes
                .iter()
                .any(|candidate| candidate.id.as_str() == scene)
        {
            return Err(ArtifactError::NotFound(format!(
                "scene {scene:?} not found in version {}",
                current.number
            )));
        }

        let document = self.load_document(&document_id).await?;
        let item_id = request.item_id.unwrap_or_else(uuid::Uuid::new_v4);
        span.record("item_id", item_id.to_string());
        // Derived from the item id, so a retried placement finds its mention.
        let mention_id = uuid::Uuid::new_v5(&item_id, CANVAS_REFERENCE_NAMESPACE);
        self.canvases
            .record_reference(mention_id, &canvas_id, &document_id, &publisher.user_id)
            .await?;
        // A failed embed keeps the mention: the caller retries with the same
        // item id, which converges on this mention and one node.
        self.canvases
            .embed(
                canvas,
                publisher,
                CanvasDocumentNode {
                    item_id,
                    document_id: document_id.clone(),
                    name: document.document_name.clone(),
                    file_type: ARTIFACT_FILE_TYPE.to_string(),
                    subpath: request.scene,
                    x: request.x,
                    y: request.y,
                    width: request.width,
                    height: request.height,
                    mention_id,
                },
            )
            .await?;
        Ok(Placement { item_id })
    }

    #[tracing::instrument(
        name = "artifact.content",
        skip_all,
        fields(
            document_id = request.host_document_id.as_str(),
            version = request.version,
            path = request.path.as_str(),
            cache = Empty,
        ),
        err(level = tracing::Level::INFO)
    )]
    async fn content(&self, request: ContentRequest) -> Result<ContentResponse, ArtifactError> {
        let verified = self.tokens.verify(&request.token).ok_or_else(|| {
            ArtifactError::Forbidden("the view token is invalid or expired".to_string())
        })?;
        if verified.document_id != request.host_document_id {
            return Err(ArtifactError::Forbidden(
                "the view token is for another artifact".to_string(),
            ));
        }

        let version = self
            .repository
            .version(&request.host_document_id, request.version)
            .await?
            .ok_or_else(|| ArtifactError::NotFound("version not found".to_string()))?;

        let path = if request.path.is_empty() {
            ENTRY_PATH.to_string()
        } else {
            request.path
        };
        let file = version
            .manifest
            .files
            .get(&ArtifactPath(path))
            .ok_or_else(|| ArtifactError::NotFound("file not found".to_string()))?;

        let span = tracing::Span::current();
        if request.cached_sha256.as_deref() == Some(file.sha256.as_str()) {
            span.record("cache", "not_modified");
            return Ok(ContentResponse::NotModified {
                sha256: file.sha256.clone(),
            });
        }

        let body = self
            .object_store
            .get(&request.host_document_id, &file.sha256)
            .await?
            .ok_or_else(|| {
                ArtifactError::Internal(anyhow::anyhow!(
                    "object {} of version {} is missing",
                    file.sha256.as_str(),
                    version.number
                ))
            })?;
        span.record("cache", "served");

        Ok(ContentResponse::File {
            content_type: file.content_type.clone(),
            size: file.size,
            sha256: file.sha256.clone(),
            body,
        })
    }
}
