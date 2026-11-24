//! What the import knows about a user's Autodesk data and its own ledger.

use std::fmt;

use chrono::{DateTime, Utc};
use nom::bytes::complete::{tag, take_till1};
use nom::character::complete::char;
use nom::combinator::{all_consuming, rest, verify};
use nom::sequence::preceded;
use nom::{IResult, Parser};
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The longest APS id the import accepts. APS ids are URNs or `a.`/`b.`
/// prefixed base64, well under this.
const MAX_ID_LEN: usize = 512;

/// An id that is not shaped like an APS id.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("`{0}` is not an Autodesk id")]
pub struct InvalidApsId(pub String);

/// An APS id is printable ASCII with no spaces, so it can be placed in a URL
/// path segment and compared as given.
fn aps_id(raw: &str) -> Result<String, InvalidApsId> {
    let valid = !raw.is_empty()
        && raw.len() <= MAX_ID_LEN
        && raw.bytes().all(|byte| byte.is_ascii_graphic());
    if valid {
        Ok(raw.to_owned())
    } else {
        Err(InvalidApsId(raw.to_owned()))
    }
}

/// An APS hub (a Fusion team or personal hub), e.g. `a.ZXhhbXBsZTp3aXAx`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct HubId(String);

impl HubId {
    /// Check that `raw` is shaped like an APS id.
    pub fn parse(raw: &str) -> Result<Self, InvalidApsId> {
        aps_id(raw).map(Self)
    }

    /// The id as APS spells it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An APS project, e.g. `a.ZXhhbXBsZTp3aXAx...` or `b.c2960674-...`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct ApsProjectId(String);

impl ApsProjectId {
    /// Check that `raw` is shaped like an APS id.
    pub fn parse(raw: &str) -> Result<Self, InvalidApsId> {
        aps_id(raw).map(Self)
    }

    /// The id as APS spells it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An APS folder URN, e.g. `urn:adsk.wipprod:fs.folder:co.0J4p...`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct ApsFolderId(String);

impl ApsFolderId {
    /// Check that `raw` is shaped like an APS id.
    pub fn parse(raw: &str) -> Result<Self, InvalidApsId> {
        aps_id(raw).map(Self)
    }

    /// The id as APS spells it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An APS item: the lineage URN every version of one design or file shares,
/// e.g. `urn:adsk.wipprod:dm.lineage:hC6k4hndRWaeIVhIjvHu8w`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct ItemId(String);

impl ItemId {
    /// Check that `raw` is shaped like an APS id.
    pub fn parse(raw: &str) -> Result<Self, InvalidApsId> {
        aps_id(raw).map(Self)
    }

    /// The id as APS spells it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One APS version of an item, e.g.
/// `urn:adsk.wipprod:fs.file:vf.b909RzMKR4mhc3O7UBY_8g?version=2`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct VersionId(String);

impl VersionId {
    /// Check that `raw` is shaped like an APS id.
    pub fn parse(raw: &str) -> Result<Self, InvalidApsId> {
        aps_id(raw).map(Self)
    }

    /// The id as APS spells it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Where a version's bytes are kept in APS's Object Storage Service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageObject {
    /// The OSS bucket, e.g. `wip.dm.prod`.
    pub bucket_key: String,
    /// The object in it, e.g. `9f8bdc3f-e29c-4ada-ab7b-bb8dfa821163.pdf`.
    pub object_key: String,
}

/// The prefix of a version's `relationships.storage.data.id`.
const STORAGE_URN_PREFIX: &str = "urn:adsk.objects:os.object:";

impl StorageObject {
    /// Read `urn:adsk.objects:os.object:<bucketKey>/<objectKey>`. The bucket
    /// key never holds a `/`; the object key may.
    pub fn parse(urn: &str) -> Option<Self> {
        fn storage(input: &str) -> IResult<&str, (&str, &str)> {
            preceded(
                tag(STORAGE_URN_PREFIX),
                (
                    take_till1(|ch| ch == '/'),
                    preceded(char('/'), verify(rest, |key: &str| !key.is_empty())),
                ),
            )
            .parse(input)
        }

        let (_, (bucket_key, object_key)) = all_consuming(storage).parse(urn).ok()?;
        Some(Self {
            bucket_key: bucket_key.to_owned(),
            object_key: object_key.to_owned(),
        })
    }
}

/// A hub the user can open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hub {
    /// Its id.
    pub id: HubId,
    /// Its name.
    pub name: String,
}

/// A project in a hub.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApsProject {
    /// Its id.
    pub id: ApsProjectId,
    /// Its name.
    pub name: String,
}

/// A folder in a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folder {
    /// Its id.
    pub id: ApsFolderId,
    /// Its name.
    pub name: String,
}

/// A design or file in a project, as APS lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FusionItem {
    /// Its lineage id.
    pub id: ItemId,
    /// Its display name.
    pub name: String,
    /// The number of its latest version, when APS said.
    pub latest_version: Option<u32>,
}

/// What a folder holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FolderEntry {
    /// A subfolder.
    Folder(Folder),
    /// A design or file.
    Item(FusionItem),
}

/// One page of a folder's contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderPage {
    /// The entries on this page.
    pub entries: Vec<FolderEntry>,
    /// The page to ask for next, when there is one.
    pub next_page: Option<u32>,
}

/// One APS version of an item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FusionVersion {
    /// Its id.
    pub id: VersionId,
    /// Its number, from 1.
    pub number: u32,
    /// When it was made in Autodesk.
    pub created_at: Option<DateTime<Utc>>,
    /// Its size in bytes, when APS said.
    pub size: Option<u64>,
    /// Its file extension, lowercase, e.g. `f3d` or `step`.
    pub extension: Option<String>,
    /// Where its bytes are, when it has downloadable storage.
    pub storage: Option<StorageObject>,
}

/// A short-lived signed address for a stored object's bytes. It grants access
/// by itself, so it never shows in `Debug` output, logs or spans.
#[derive(Clone, PartialEq, Eq)]
pub struct SignedUrl {
    /// The parts to fetch and join in order: one for a whole object, several
    /// for an object APS still keeps in chunks.
    pub parts: Vec<String>,
    /// The object's size in bytes, when APS said.
    pub size: Option<u64>,
}

impl fmt::Debug for SignedUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SignedUrl")
            .field("parts", &self.parts.len())
            .field("size", &self.size)
            .finish()
    }
}

/// Whether the Macro document of a tracked item exists yet.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr, strum::Display,
)]
#[strum(serialize_all = "snake_case")]
pub enum LinkState {
    /// The document id is chosen; the document may not exist yet.
    Creating,
    /// The document exists and holds at least one version.
    Linked,
}

/// What became of one APS version.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    JsonSchema,
    strum::EnumString,
    strum::IntoStaticStr,
    strum::Display,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum VersionOutcome {
    /// Its bytes are a version of the document.
    Imported,
    /// It has no downloadable storage, or APS refused the download.
    Unavailable,
    /// It is larger than a document version may be.
    TooLarge,
    /// Its file type is not one Macro keeps versions of, or differs from the
    /// document's.
    UnsupportedFormat,
}

/// An item the user imported, as the ledger holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackedItem {
    /// The APS item.
    pub item_id: ItemId,
    /// Its APS project.
    pub project_id: ApsProjectId,
    /// The Macro document its versions go to.
    pub document_id: Uuid,
    /// Whether that document exists yet.
    pub state: LinkState,
}

/// A tracked item with how many of its versions are imported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackedSummary {
    /// The item.
    pub item: TrackedItem,
    /// How many of its versions are document versions.
    pub imported_versions: u32,
}

/// One APS version the ledger has recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedVersion {
    /// The version.
    pub version_id: VersionId,
    /// Its number.
    pub number: u32,
    /// What became of it.
    pub outcome: VersionOutcome,
    /// Its file extension, when known.
    pub extension: Option<String>,
}

/// One APS version to record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionRecord {
    /// The version.
    pub version_id: VersionId,
    /// Its number.
    pub number: u32,
    /// What became of it, with the document version for an import.
    pub outcome: RecordedOutcome,
    /// Its size in bytes, when known.
    pub size: Option<u64>,
    /// Its file extension, when known.
    pub extension: Option<String>,
    /// When it was made in Autodesk.
    pub created_at: Option<DateTime<Utc>>,
}

/// What became of a version, with what each outcome carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordedOutcome {
    /// Imported as this `DocumentInstance` id.
    Imported {
        /// The document version.
        document_version_id: i64,
    },
    /// Not imported, for this reason.
    Skipped(SkipReason),
}

/// Why a version was not imported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// See [`VersionOutcome::Unavailable`].
    Unavailable,
    /// See [`VersionOutcome::TooLarge`].
    TooLarge,
    /// See [`VersionOutcome::UnsupportedFormat`].
    UnsupportedFormat,
}

impl RecordedOutcome {
    /// The outcome as the ledger names it.
    pub fn outcome(self) -> VersionOutcome {
        match self {
            Self::Imported { .. } => VersionOutcome::Imported,
            Self::Skipped(SkipReason::Unavailable) => VersionOutcome::Unavailable,
            Self::Skipped(SkipReason::TooLarge) => VersionOutcome::TooLarge,
            Self::Skipped(SkipReason::UnsupportedFormat) => VersionOutcome::UnsupportedFormat,
        }
    }

    /// The document version, for an import.
    pub fn document_version_id(self) -> Option<i64> {
        match self {
            Self::Imported {
                document_version_id,
            } => Some(document_version_id),
            Self::Skipped(_) => None,
        }
    }
}

/// Where in the user's Autodesk data to look.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowseAt {
    /// The hubs the user can open.
    Hubs,
    /// The projects in a hub.
    Projects {
        /// The hub.
        hub: HubId,
    },
    /// A project's top folders.
    TopFolders {
        /// The project's hub.
        hub: HubId,
        /// The project.
        project: ApsProjectId,
    },
    /// One page of a folder.
    Folder {
        /// The folder's project.
        project: ApsProjectId,
        /// The folder.
        folder: ApsFolderId,
        /// The page, from 0.
        page: u32,
    },
}

/// One thing a browse shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BrowseEntry {
    /// A hub; browse it with its `hubId`.
    Hub {
        /// Its id.
        #[serde(rename = "hubId")]
        id: HubId,
        /// Its name.
        name: String,
    },
    /// A project; browse it with its `hubId` and `projectId`.
    Project {
        /// Its id.
        #[serde(rename = "projectId")]
        id: ApsProjectId,
        /// Its name.
        name: String,
    },
    /// A folder; browse it with the `projectId` and its `folderId`.
    Folder {
        /// Its id.
        #[serde(rename = "folderId")]
        id: ApsFolderId,
        /// Its name.
        name: String,
    },
    /// A design or file; import it with the `projectId` and its `itemId`.
    Item {
        /// Its id.
        #[serde(rename = "itemId")]
        id: ItemId,
        /// Its name.
        name: String,
        /// Its latest version number.
        #[serde(rename = "latestVersion")]
        latest_version: Option<u32>,
        /// Where it already is in Macro, when the user imported it.
        tracked: Option<TrackedView>,
    },
}

/// An item the user already imported, as a browse shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrackedView {
    /// The Macro document, once it exists.
    pub document_id: Option<Uuid>,
    /// How many of its versions are in Macro.
    pub imported_versions: u32,
}

/// What a browse found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrowsePage {
    /// What is there.
    pub entries: Vec<BrowseEntry>,
    /// For a folder: the `cursor` of its next page, when there is one.
    pub next_cursor: Option<String>,
}

/// What an import or sync did to one item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema, strum::IntoStaticStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ItemStatus {
    /// Its versions were brought up to date, up to this call's budget.
    Synced,
    /// Another import or sync of it is running; try again shortly.
    Busy,
    /// Its Macro document was deleted or trashed; `import` it again to make a
    /// new one.
    DocumentGone,
    /// This call's download budget ran out before reaching it.
    NotReached,
    /// It is not in this Autodesk account, or the user can't open it.
    NotFound,
    /// It was never imported, so there is nothing to sync.
    NotTracked,
    /// Autodesk is rate limiting; try again later.
    RateLimited,
    /// Autodesk or Macro failed; try again later.
    Failed,
}

/// A version that was not imported, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkippedVersion {
    /// Its number.
    pub version_number: u32,
    /// Why it was not imported.
    pub outcome: VersionOutcome,
}

/// What an import or sync did to one item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemReport {
    /// The APS item.
    pub item_id: ItemId,
    /// What happened.
    pub status: ItemStatus,
    /// Its Macro document, once it exists.
    pub document_id: Option<Uuid>,
    /// Versions imported by this call.
    pub imported_now: u32,
    /// Versions imported by earlier calls.
    pub already_imported: u32,
    /// Versions that were not imported, and why.
    pub skipped: Vec<SkippedVersion>,
    /// Versions still to import; call `sync` again for them.
    pub remaining: u32,
}

impl ItemReport {
    /// A report of an item that nothing was done to.
    pub fn untouched(item_id: ItemId, status: ItemStatus) -> Self {
        Self {
            item_id,
            status,
            document_id: None,
            imported_now: 0,
            already_imported: 0,
            skipped: Vec::new(),
            remaining: 0,
        }
    }
}

/// What an import or sync did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// Each item, in the order asked.
    pub items: Vec<ItemReport>,
    /// Versions still to import across the items reached.
    pub remaining: u32,
    /// Items the budget ran out before; `sync` reaches them next.
    pub not_reached: u32,
    /// For a sync of all items: where the next sync starts, while some
    /// items still have work or were not listed yet.
    pub next_cursor: Option<ItemId>,
}

impl SyncReport {
    /// The report of `items`, with the totals counted and no cursor.
    pub fn of(items: Vec<ItemReport>) -> Self {
        let remaining = items.iter().map(|item| item.remaining).sum();
        let not_reached = items
            .iter()
            .filter(|item| item.status == ItemStatus::NotReached)
            .count();
        Self {
            items,
            remaining,
            not_reached: u32::try_from(not_reached).unwrap_or(u32::MAX),
            next_cursor: None,
        }
    }
}

/// Which imported items a sync covers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncScope {
    /// These items.
    Items(Vec<ItemId>),
    /// All of the user's imported items in id order, one page per call,
    /// from this item on (the previous report's `next_cursor`).
    All {
        /// Where to start, or `None` for the first item.
        from: Option<ItemId>,
    },
}
