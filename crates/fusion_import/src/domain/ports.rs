//! What the import needs from Autodesk, storage downloads, its ledger, Macro
//! documents and the rollout.

use std::time::Duration;

use bytes::Bytes;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_file_type::FileType;
use upstream_error::UpstreamError;
use uuid::Uuid;

use super::models::{
    ApsFolderId, ApsProject, ApsProjectId, Folder, FolderPage, FusionItem, FusionVersion, Hub,
    HubId, ItemId, RecordedVersion, SignedUrl, StorageObject, TrackedItem, TrackedSummary,
    VersionRecord,
};

/// Why a read from Autodesk failed.
#[derive(Debug, thiserror::Error)]
pub enum ApsError {
    /// The user's Autodesk grant stopped working; they must connect again.
    #[error("the Autodesk connection must be authorized again")]
    NeedsReauth,
    /// Autodesk has no such hub, project, folder, item or object for this
    /// account.
    #[error("not found in this Autodesk account")]
    NotFound,
    /// The account may not open it.
    #[error("this Autodesk account may not open it")]
    Forbidden,
    /// Autodesk asked us to slow down, even after waiting once.
    #[error("Autodesk is rate limiting requests")]
    RateLimited {
        /// How long Autodesk asked us to wait, when it said.
        retry_after: Option<Duration>,
    },
    /// Autodesk is down or answered with something unusable.
    #[error(transparent)]
    Upstream(UpstreamError),
    /// Reaching Autodesk failed on our side.
    #[error("Autodesk read failed: {0:?}")]
    Internal(rootcause::Report),
}

/// Users' Autodesk accounts.
pub trait ApsConnections: Send + Sync + 'static {
    /// The reader of one user's account.
    type Reader: ApsReader;

    /// The user's Autodesk account, when they connected one that gives API
    /// access.
    fn for_user(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Self::Reader>, ApsError>> + Send;
}

/// Reads one user's Autodesk data. It never writes to Autodesk.
pub trait ApsReader: Send + Sync {
    /// The hubs the user can open.
    fn hubs(&self) -> impl Future<Output = Result<Vec<Hub>, ApsError>> + Send;

    /// Every project in a hub.
    fn projects(
        &self,
        hub: &HubId,
    ) -> impl Future<Output = Result<Vec<ApsProject>, ApsError>> + Send;

    /// A project's top folders.
    fn top_folders(
        &self,
        hub: &HubId,
        project: &ApsProjectId,
    ) -> impl Future<Output = Result<Vec<Folder>, ApsError>> + Send;

    /// One page of a folder's contents, from page 0.
    fn folder_contents(
        &self,
        project: &ApsProjectId,
        folder: &ApsFolderId,
        page: u32,
    ) -> impl Future<Output = Result<FolderPage, ApsError>> + Send;

    /// One item.
    fn item(
        &self,
        project: &ApsProjectId,
        item: &ItemId,
    ) -> impl Future<Output = Result<FusionItem, ApsError>> + Send;

    /// Every version of an item, in any order.
    fn versions(
        &self,
        project: &ApsProjectId,
        item: &ItemId,
    ) -> impl Future<Output = Result<Vec<FusionVersion>, ApsError>> + Send;

    /// A short-lived address of a stored object's bytes.
    fn signed_download(
        &self,
        storage: &StorageObject,
    ) -> impl Future<Output = Result<SignedUrl, ApsError>> + Send;
}

/// What a download fetched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Download {
    /// The whole object.
    Bytes(Bytes),
    /// The object is larger than the cap; nothing past it was read.
    TooLarge,
}

/// Why a download failed.
#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    /// Storage answered with this non-success status.
    #[error("storage answered {0}")]
    Status(u16),
    /// Storage could not be reached, or the address was unusable.
    #[error("download failed: {0:?}")]
    Internal(rootcause::Report),
}

/// Fetches bytes from signed storage addresses, which need no credentials.
pub trait SignedDownloads: Send + Sync + 'static {
    /// The object behind `url`, read no further than `max_bytes`.
    fn fetch(
        &self,
        url: &SignedUrl,
        max_bytes: u64,
    ) -> impl Future<Output = Result<Download, DownloadError>> + Send;
}

/// One sync's hold on an item. Only its holder writes the item's versions
/// until `until`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claim {
    /// The item as it stood when claimed.
    pub item: TrackedItem,
    /// When the hold lapses; releasing names it, so a lapsed hold never
    /// releases someone else's.
    pub until: DateTime<Utc>,
}

/// The ledger of imported items and their versions.
pub trait FusionRepo: Send + Sync + 'static {
    /// The repository's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Track an item, with `document_id` for its document, or answer the row
    /// already there (whose document id wins).
    fn track(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        project: &ApsProjectId,
        document_id: Uuid,
    ) -> impl Future<Output = Result<TrackedItem, Self::Err>> + Send;

    /// The tracked items among `items`, with their imported version counts.
    fn tracked(
        &self,
        user: &MacroUserIdStr<'static>,
        items: &[ItemId],
    ) -> impl Future<Output = Result<Vec<TrackedSummary>, Self::Err>> + Send;

    /// Up to `limit` of the user's tracked items in id order, from `from` on.
    fn tracked_items(
        &self,
        user: &MacroUserIdStr<'static>,
        from: Option<&ItemId>,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<TrackedItem>, Self::Err>> + Send;

    /// Hold the item for `lease`, unless a hold that hasn't lapsed is on it.
    fn claim(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        lease: Duration,
    ) -> impl Future<Output = Result<Option<Claim>, Self::Err>> + Send;

    /// Let go of a hold and stamp the item synced.
    fn release(
        &self,
        user: &MacroUserIdStr<'static>,
        claim: &Claim,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record that the item's document exists.
    fn mark_linked(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Point the item at a new, not yet created document and forget its
    /// versions, after its old document was deleted.
    fn relink(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        document_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Every version recorded for the item.
    fn recorded_versions(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
    ) -> impl Future<Output = Result<Vec<RecordedVersion>, Self::Err>> + Send;

    /// Record a version; recording it again changes nothing.
    fn record_version(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        version: &VersionRecord,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The result of creating an item's document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreatedCad {
    /// The document was made, with these bytes as its first version.
    Created {
        /// The first version.
        document_version_id: i64,
    },
    /// A document with this id exists already: an earlier attempt made it.
    AlreadyExists,
}

/// A version added to a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AddedVersion {
    /// The document version holding the bytes.
    pub document_version_id: i64,
    /// False when the newest version already held these bytes, so nothing
    /// was added.
    pub created: bool,
}

/// Macro file documents that hold an item's versions.
pub trait CadDocuments: Send + Sync + 'static {
    /// The documents service's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Make the user's document `document_id` with `bytes` as its first
    /// version.
    fn create(
        &self,
        user: &MacroUserIdStr<'static>,
        document_id: Uuid,
        name: &str,
        file_type: FileType,
        bytes: Bytes,
    ) -> impl Future<Output = Result<CreatedCad, Self::Err>> + Send;

    /// Add `bytes` as the document's newest version, unless the newest
    /// already holds them.
    fn add_version(
        &self,
        user: &MacroUserIdStr<'static>,
        document_id: Uuid,
        bytes: Bytes,
    ) -> impl Future<Output = Result<AddedVersion, Self::Err>> + Send;

    /// Whether the document exists and is not in the Trash.
    fn is_live(&self, document_id: Uuid) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Who may use the import.
pub trait FusionRollout: Send + Sync + 'static {
    /// True when the user may import from Autodesk; any failure to decide is
    /// false.
    fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> impl Future<Output = bool> + Send;
}
