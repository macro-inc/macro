//! Ports of the artifact domain.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use model::document::DocumentBasic;
use model_owner::CreationPrincipal;

use super::models::{
    Artifact, ArtifactError, ArtifactVersion, ArtifactVersionSummary, ContentRequest,
    ContentResponse, CreateArtifact, Manifest, MintedToken, ObjectBody, PlaceArtifact, Placement,
    PublishVersion, Publisher, Sha256, UploadInput, UploadTarget, ViewUrl, ViewUrlRequest,
};

/// A version to insert.
#[derive(Debug, Clone)]
pub struct NewVersion {
    /// The artifact document.
    pub document_id: String,
    /// Its number, one past the current version.
    pub number: i32,
    /// Files and scenes.
    pub manifest: Manifest,
    /// What changed.
    pub message: Option<String>,
    /// The publishing user.
    pub created_by: String,
    /// The bot publishing for them.
    pub created_by_agent: Option<String>,
}

/// Version storage.
pub trait ArtifactRepository: Send + Sync + 'static {
    /// The highest-numbered version.
    fn current_version(
        &self,
        document_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<ArtifactVersion>>> + Send;

    /// One version.
    fn version(
        &self,
        document_id: &str,
        number: i32,
    ) -> impl Future<Output = anyhow::Result<Option<ArtifactVersion>>> + Send;

    /// Every version, newest first.
    fn versions(
        &self,
        document_id: &str,
    ) -> impl Future<Output = anyhow::Result<Vec<ArtifactVersionSummary>>> + Send;

    /// Sizes of the given digests as recorded by any version of the artifact.
    fn recorded_sizes(
        &self,
        document_id: &str,
        digests: &HashSet<Sha256>,
    ) -> impl Future<Output = anyhow::Result<HashMap<Sha256, u64>>> + Send;

    /// Insert a version. `None` when its number is already taken.
    fn insert_version(
        &self,
        version: NewVersion,
    ) -> impl Future<Output = anyhow::Result<Option<ArtifactVersion>>> + Send;
}

/// A presigned upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresignedUpload {
    /// URL to `PUT` to.
    pub url: String,
    /// Headers the `PUT` must carry.
    pub headers: BTreeMap<String, String>,
}

/// Content-addressed object storage, keyed by artifact and digest.
pub trait ArtifactObjectStore: Send + Sync + 'static {
    /// The stored object's size, if it exists.
    fn size(
        &self,
        document_id: &str,
        sha256: &Sha256,
    ) -> impl Future<Output = anyhow::Result<Option<u64>>> + Send;

    /// Store bytes whose digest the caller verified.
    fn put(
        &self,
        document_id: &str,
        sha256: &Sha256,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// A URL the publisher can `PUT` exactly these bytes to.
    fn presign_put(
        &self,
        document_id: &str,
        sha256: &Sha256,
        size: u64,
        content_type: &str,
    ) -> impl Future<Output = anyhow::Result<PresignedUpload>> + Send;

    /// The object's bytes, if it exists.
    fn get(
        &self,
        document_id: &str,
        sha256: &Sha256,
    ) -> impl Future<Output = anyhow::Result<Option<ObjectBody>>> + Send;
}

/// The document an artifact is, owned by the documents domain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedArtifactDocument {
    /// Document id.
    pub document_id: String,
    /// Document name, as the documents domain cleaned it.
    pub name: String,
    /// Owner principal string.
    pub owner: String,
}

/// The documents domain, as artifacts use it.
pub trait ArtifactDocuments: Send + Sync + 'static {
    /// Create an artifact document with the defaults every created document
    /// gets (owner, folder, share permission).
    fn create(
        &self,
        principal: &CreationPrincipal,
        name: String,
        project_id: Option<uuid::Uuid>,
    ) -> impl Future<Output = Result<CreatedArtifactDocument, ArtifactError>> + Send;

    /// Delete a document whose artifact could not be created.
    fn discard(&self, document_id: &str) -> impl Future<Output = ()> + Send;

    /// A document's basic metadata, without access checks.
    fn load(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<Option<DocumentBasic>, ArtifactError>> + Send;
}

/// A view token that verified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedToken {
    /// The document the token was minted for.
    pub document_id: String,
}

/// Signed view tokens for the content origin. A page can read its own URL,
/// so a view token grants reading that artifact's files and nothing else.
pub trait ViewTokens: Send + Sync + 'static {
    /// Mint a token for a viewer whose view access was checked. It names
    /// only the document: the page can decode it, so it carries no identity.
    fn mint(&self, document_id: &str) -> Result<MintedToken, ArtifactError>;

    /// Verify a token's signature and expiry. `None` when it does not verify.
    fn verify(&self, token: &str) -> Option<VerifiedToken>;
}

/// Tells people who have an artifact open that a version was published.
pub trait ArtifactNotifier: Send + Sync + 'static {
    /// Best effort: a failed notice never fails the publish.
    fn published(&self, document_id: &str, version: i32) -> impl Future<Output = ()> + Send;
}

/// A document node to add to a canvas, as the canvas UI inserts one.
#[derive(Debug, Clone, PartialEq)]
pub struct CanvasDocumentNode {
    /// The node's canvas item id; committing it again is a no-op.
    pub item_id: uuid::Uuid,
    /// The embedded document.
    pub document_id: String,
    /// Its name, shown on the node.
    pub name: String,
    /// Its file type.
    pub file_type: String,
    /// Host navigation state inside the document: the scene id of an artifact.
    pub subpath: Option<String>,
    /// World x of the top-left corner.
    pub x: f64,
    /// World y of the top-left corner.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
    /// The canvas's entity mention of the document, which the canvas tracks
    /// next to the node so its own reference bookkeeping sees it as recorded.
    pub mention_id: uuid::Uuid,
}

/// Canvases, as placing an artifact on one uses them.
pub trait ArtifactCanvases: Send + Sync + 'static {
    /// Record that `canvas_id` references `document_id` as mention
    /// `mention_id`, through the same entity mention the canvas UI records
    /// when it inserts a document node. A mention already recorded under
    /// that id is kept, so retries record it once.
    fn record_reference(
        &self,
        mention_id: uuid::Uuid,
        canvas_id: &str,
        document_id: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<(), ArtifactError>> + Send;

    /// Commit `node` to the live canvas through the canvas editing path. A
    /// node already committed under its item id is left as it is.
    fn embed(
        &self,
        canvas: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        node: CanvasDocumentNode,
    ) -> impl Future<Output = Result<(), ArtifactError>> + Send;
}

/// Artifact use cases.
pub trait ArtifactService: Send + Sync + 'static {
    /// An artifact document's metadata for the access extractors. Documents
    /// of other file types are not found.
    fn load_document(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<DocumentBasic, ArtifactError>> + Send;

    /// Create an artifact, with its first version when files are given.
    fn create(
        &self,
        principal: &CreationPrincipal,
        publisher: &Publisher,
        request: CreateArtifact,
    ) -> impl Future<Output = Result<Artifact, ArtifactError>> + Send;

    /// Presigned uploads for the objects not yet stored for the artifact.
    fn uploads(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        files: Vec<UploadInput>,
    ) -> impl Future<Output = Result<Vec<UploadTarget>, ArtifactError>> + Send;

    /// Publish a new version.
    fn publish(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        request: PublishVersion,
    ) -> impl Future<Output = Result<ArtifactVersion, ArtifactError>> + Send;

    /// The artifact with its current version.
    fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Artifact, ArtifactError>> + Send;

    /// Version history, newest first.
    fn versions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<ArtifactVersionSummary>, ArtifactError>> + Send;

    /// One version.
    fn version(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        number: i32,
    ) -> impl Future<Output = Result<ArtifactVersion, ArtifactError>> + Send;

    /// Publish an old version's manifest again as the newest version.
    fn restore(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        number: i32,
    ) -> impl Future<Output = Result<ArtifactVersion, ArtifactError>> + Send;

    /// A URL rendering a version on the artifact's origin.
    fn view_url(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: ViewUrlRequest,
    ) -> impl Future<Output = Result<ViewUrl, ArtifactError>> + Send;

    /// A canvas document's metadata for the access extractors. Documents of
    /// other file types are refused.
    fn load_canvas(
        &self,
        canvas_id: &str,
    ) -> impl Future<Output = Result<DocumentBasic, ArtifactError>> + Send;

    /// Place the artifact, or one of its scenes, on a canvas.
    fn place(
        &self,
        artifact: EntityAccessReceipt<ViewAccessLevel>,
        canvas: EntityAccessReceipt<EditAccessLevel>,
        publisher: &Publisher,
        request: PlaceArtifact,
    ) -> impl Future<Output = Result<Placement, ArtifactError>> + Send;

    /// One file of a version, for a request on the artifact's origin.
    fn content(
        &self,
        request: ContentRequest,
    ) -> impl Future<Output = Result<ContentResponse, ArtifactError>> + Send;
}
