//! In-memory port implementations for service and router tests.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use model::document::DocumentBasic;
use model_owner::{CreationPrincipal, Owner};

use crate::domain::models::{
    ArtifactError, ArtifactVersion, ArtifactVersionSummary, MintedToken, ObjectBody, Publisher,
    Sha256, Viewer,
};
use crate::domain::ports::{
    ArtifactCanvases, ArtifactDocuments, ArtifactNotifier, ArtifactObjectStore, ArtifactRepository,
    CanvasDocumentNode, CreatedArtifactDocument, NewVersion, PresignedUpload, VerifiedToken,
    ViewTokens,
};

pub(crate) const CREATED_AT: &str = "2026-11-04T12:00:00Z";

/// Versions in memory, keyed by document id.
#[derive(Default)]
pub(crate) struct MemoryRepository {
    pub(crate) versions: Mutex<HashMap<String, Vec<ArtifactVersion>>>,
}

impl ArtifactRepository for MemoryRepository {
    async fn current_version(&self, document_id: &str) -> anyhow::Result<Option<ArtifactVersion>> {
        let versions = self.versions.lock().unwrap();
        Ok(versions
            .get(document_id)
            .and_then(|versions| versions.iter().max_by_key(|version| version.number))
            .cloned())
    }

    async fn version(
        &self,
        document_id: &str,
        number: i32,
    ) -> anyhow::Result<Option<ArtifactVersion>> {
        let versions = self.versions.lock().unwrap();
        Ok(versions
            .get(document_id)
            .and_then(|versions| versions.iter().find(|version| version.number == number))
            .cloned())
    }

    async fn versions(&self, document_id: &str) -> anyhow::Result<Vec<ArtifactVersionSummary>> {
        let versions = self.versions.lock().unwrap();
        let mut summaries: Vec<ArtifactVersionSummary> = versions
            .get(document_id)
            .into_iter()
            .flatten()
            .map(|version| ArtifactVersionSummary {
                number: version.number,
                message: version.message.clone(),
                created_by: version.created_by.clone(),
                created_by_agent: version.created_by_agent.clone(),
                created_at: version.created_at,
                file_count: version.manifest.files.len(),
                total_size: version.manifest.total_size(),
            })
            .collect();
        summaries.sort_by_key(|summary| -summary.number);
        Ok(summaries)
    }

    async fn recorded_sizes(
        &self,
        document_id: &str,
        digests: &HashSet<Sha256>,
    ) -> anyhow::Result<HashMap<Sha256, u64>> {
        let versions = self.versions.lock().unwrap();
        Ok(versions
            .get(document_id)
            .into_iter()
            .flatten()
            .flat_map(|version| version.manifest.files.values())
            .filter(|file| digests.contains(&file.sha256))
            .map(|file| (file.sha256.clone(), file.size))
            .collect())
    }

    async fn insert_version(&self, version: NewVersion) -> anyhow::Result<Option<ArtifactVersion>> {
        let mut versions = self.versions.lock().unwrap();
        let document_versions = versions.entry(version.document_id).or_default();
        if document_versions
            .iter()
            .any(|existing| existing.number == version.number)
        {
            return Ok(None);
        }
        let inserted = ArtifactVersion {
            number: version.number,
            manifest: version.manifest,
            message: version.message,
            created_by: version.created_by,
            created_by_agent: version.created_by_agent,
            created_at: CREATED_AT.parse::<DateTime<Utc>>().unwrap(),
        };
        document_versions.push(inserted.clone());
        Ok(Some(inserted))
    }
}

/// Objects in memory, keyed by `(document id, digest)`.
#[derive(Default)]
pub(crate) struct MemoryObjectStore {
    pub(crate) objects: Mutex<HashMap<(String, String), Vec<u8>>>,
}

impl ArtifactObjectStore for MemoryObjectStore {
    async fn size(&self, document_id: &str, sha256: &Sha256) -> anyhow::Result<Option<u64>> {
        let objects = self.objects.lock().unwrap();
        Ok(objects
            .get(&(document_id.to_string(), sha256.as_str().to_string()))
            .map(|bytes| bytes.len() as u64))
    }

    async fn put(
        &self,
        document_id: &str,
        sha256: &Sha256,
        _content_type: &str,
        bytes: Vec<u8>,
    ) -> anyhow::Result<()> {
        self.objects.lock().unwrap().insert(
            (document_id.to_string(), sha256.as_str().to_string()),
            bytes,
        );
        Ok(())
    }

    async fn presign_put(
        &self,
        document_id: &str,
        sha256: &Sha256,
        _size: u64,
        content_type: &str,
    ) -> anyhow::Result<PresignedUpload> {
        Ok(PresignedUpload {
            url: format!(
                "https://bucket.test/artifacts/{document_id}/{}",
                sha256.as_str()
            ),
            headers: [("content-type".to_string(), content_type.to_string())].into(),
        })
    }

    async fn get(&self, document_id: &str, sha256: &Sha256) -> anyhow::Result<Option<ObjectBody>> {
        let objects = self.objects.lock().unwrap();
        let bytes = objects
            .get(&(document_id.to_string(), sha256.as_str().to_string()))
            .cloned();
        Ok(bytes.map(|bytes| {
            let body: ObjectBody = Box::pin(futures::stream::iter([Ok(bytes::Bytes::from(bytes))]));
            body
        }))
    }
}

/// Documents in memory. `create` hands out `next_document_id`.
pub(crate) struct MemoryDocuments {
    pub(crate) next_document_id: String,
    pub(crate) documents: Mutex<HashMap<String, DocumentBasic>>,
    pub(crate) discarded: Mutex<Vec<String>>,
}

impl MemoryDocuments {
    pub(crate) fn new(next_document_id: &str) -> Self {
        Self {
            next_document_id: next_document_id.to_string(),
            documents: Mutex::new(HashMap::new()),
            discarded: Mutex::new(Vec::new()),
        }
    }
}

impl ArtifactDocuments for MemoryDocuments {
    async fn create(
        &self,
        principal: &CreationPrincipal,
        name: String,
        project_id: Option<uuid::Uuid>,
    ) -> Result<CreatedArtifactDocument, ArtifactError> {
        let owner: Owner = principal.owner();
        self.documents.lock().unwrap().insert(
            self.next_document_id.clone(),
            DocumentBasic {
                document_id: self.next_document_id.clone(),
                document_name: name.clone(),
                owner: owner.clone(),
                file_type: Some("artifact".to_string()),
                sub_type: None,
                branched_from_id: None,
                branched_from_version_id: None,
                document_family_id: None,
                project_id: project_id.map(|id| id.to_string()),
                deleted_at: None,
            },
        );
        Ok(CreatedArtifactDocument {
            document_id: self.next_document_id.clone(),
            name,
            owner: owner.to_string(),
        })
    }

    async fn discard(&self, document_id: &str) {
        self.documents.lock().unwrap().remove(document_id);
        self.discarded.lock().unwrap().push(document_id.to_string());
    }

    async fn load(&self, document_id: &str) -> Result<Option<DocumentBasic>, ArtifactError> {
        Ok(self.documents.lock().unwrap().get(document_id).cloned())
    }
}

/// Tokens of the form `token-for-<document id>`; anything else fails to
/// verify. Minted tokens are recorded.
#[derive(Default)]
pub(crate) struct FakeTokens {
    pub(crate) minted: Mutex<Vec<(Viewer, String)>>,
}

impl ViewTokens for FakeTokens {
    fn mint(&self, viewer: &Viewer, document_id: &str) -> Result<MintedToken, ArtifactError> {
        self.minted
            .lock()
            .unwrap()
            .push((viewer.clone(), document_id.to_string()));
        Ok(MintedToken {
            token: format!("token-for-{document_id}"),
            expires_at: "2026-11-04T13:00:00Z".parse().unwrap(),
        })
    }

    fn verify(&self, token: &str) -> Option<VerifiedToken> {
        token
            .strip_prefix("token-for-")
            .map(|document_id| VerifiedToken {
                document_id: document_id.to_string(),
            })
    }
}

/// Records published notices.
#[derive(Default)]
pub(crate) struct RecordingNotifier {
    pub(crate) published: Mutex<Vec<(String, i32)>>,
}

impl ArtifactNotifier for RecordingNotifier {
    async fn published(&self, document_id: &str, version: i32) {
        self.published
            .lock()
            .unwrap()
            .push((document_id.to_string(), version));
    }
}

/// A reference the fake canvases recorded: `(canvas id, document id, user id)`.
pub(crate) type RecordedReference = (String, String, String);

/// Canvases that record references and nodes. `refuse_embed` makes every
/// embed fail, as a canvas that refuses the write would.
#[derive(Default)]
pub(crate) struct FakeCanvases {
    pub(crate) refuse_embed: bool,
    pub(crate) references: Mutex<Vec<RecordedReference>>,
    pub(crate) forgotten: Mutex<Vec<String>>,
    pub(crate) embedded: Mutex<Vec<(String, Publisher, CanvasDocumentNode)>>,
}

impl ArtifactCanvases for FakeCanvases {
    async fn record_reference(
        &self,
        canvas_id: &str,
        document_id: &str,
        user_id: &str,
    ) -> Result<String, ArtifactError> {
        let mut references = self.references.lock().unwrap();
        references.push((
            canvas_id.to_string(),
            document_id.to_string(),
            user_id.to_string(),
        ));
        Ok(format!("mention-{}", references.len()))
    }

    async fn forget_reference(&self, mention_id: &str) {
        self.forgotten.lock().unwrap().push(mention_id.to_string());
    }

    async fn embed(
        &self,
        canvas: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        node: CanvasDocumentNode,
    ) -> Result<String, ArtifactError> {
        if self.refuse_embed {
            return Err(ArtifactError::BadRequest(
                "the canvas refused the node".to_string(),
            ));
        }
        let mut embedded = self.embedded.lock().unwrap();
        embedded.push((canvas.entity().entity_id.clone(), publisher.clone(), node));
        Ok(format!("item-{}", embedded.len()))
    }
}
