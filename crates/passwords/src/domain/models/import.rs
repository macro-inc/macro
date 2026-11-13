//! Bounded import commands and payload-free results.
use super::*;

/// Opaque source identity, bounded before hashing or returning it to a caller.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(try_from = "String", into = "String")]
#[schema(value_type = String, as = PasswordImportKey)]
pub struct ImportKey(String);
impl TryFrom<String> for ImportKey {
    type Error = Error;
    fn try_from(value: String) -> Result<Self, Error> {
        if value.is_empty() || value.len() > 200 || value.chars().any(char::is_control) {
            return Err(Error::Invalid);
        }
        Ok(Self(value))
    }
}
impl From<ImportKey> for String {
    fn from(value: ImportKey) -> Self {
        value.0
    }
}
impl AsRef<str> for ImportKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Recognized client-side source parser; contains no export contents.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordImportFormat)]
pub enum ImportFormat {
    /// 1Password unencrypted archive.
    OnePasswordPux,
    /// 1Password CSV.
    OnePasswordCsv,
    /// Bitwarden unencrypted JSON.
    BitwardenJson,
    /// Bitwarden CSV.
    BitwardenCsv,
}

/// Destination under which source folders are nested.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[schema(as = PasswordImportTarget)]
pub enum ImportTarget {
    /// Validate and use a folder already in this team.
    Existing {
        /// Destination folder identity.
        #[serde(rename = "folderId")]
        folder_id: Uuid,
    },
    /// Idempotently create a top-level destination folder.
    New {
        /// Validated using ordinary vault folder rules.
        name: String,
    },
    /// Import directly into the team vault root.
    Root,
}

/// Source folder; parents must precede children in every batch.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordImportFolder)]
pub struct ImportFolder {
    /// Opaque identity from the client parser.
    pub key: ImportKey,
    /// Validated using ordinary vault folder rules.
    pub name: String,
    /// Source parent; absent means the chosen target.
    pub parent_key: Option<ImportKey>,
}

/// One normalized credential; intentionally has no Debug implementation.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordImportItem)]
pub struct ImportItem {
    /// Stable source identity for idempotent retries.
    pub source_key: ImportKey,
    /// Display name, validated by the ordinary create path.
    pub name: String,
    /// Ordinary vault template.
    pub kind: ItemKind,
    /// Public website, validated before metadata persistence.
    pub url: Option<LoginUrl>,
    /// Source folder; absent means the chosen target.
    pub folder_key: Option<ImportKey>,
    /// Favorite state from the export.
    pub favorite: bool,
    /// Zeroizing confidential values sent only to the provider.
    pub values: SecretValues,
    /// Optional zeroizing TOTP seed, enrolled only when missing.
    pub totp: Option<SecretString>,
}

/// At most 25 credentials and 200 source folders in a request bounded to 4 MiB.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordImportBatch)]
pub struct ImportBatch {
    /// Source category recorded in the batch audit.
    pub format: ImportFormat,
    /// Root for source folders and otherwise unfiled items.
    pub target: ImportTarget,
    /// Omit the default team Edit grant on newly created items.
    pub private: bool,
    /// Source folder tree, parents first; resend with each batch.
    pub folders: Vec<ImportFolder>,
    /// Independently validated credentials.
    pub items: Vec<ImportItem>,
}

/// Closed, sanitized per-item failure categories.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordImportErrorCode)]
pub enum ImportErrorCode {
    /// Absent or hidden by access policy.
    NotFound,
    /// Creation belongs to another actor.
    Forbidden,
    /// Invalid credential, folder reference or TOTP seed.
    InvalidRequest,
    /// Conflicting operation or concurrent edit.
    VersionConflict,
    /// Referenced folder was removed.
    FolderMissing,
    /// Lease contention; retry this item.
    Busy,
    /// Required dependency unavailable; retry this item.
    VaultUnavailable,
}
impl From<Error> for ImportErrorCode {
    fn from(value: Error) -> Self {
        match value {
            Error::NotFound => Self::NotFound,
            Error::Forbidden => Self::Forbidden,
            Error::Invalid => Self::InvalidRequest,
            Error::Conflict => Self::VersionConflict,
            Error::FolderMissing => Self::FolderMissing,
            Error::Busy => Self::Busy,
            Error::Unavailable => Self::VaultUnavailable,
        }
    }
}

/// Result for a single item; failed TOTP enrollment can still return the created item id.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordImportItemResult)]
pub struct ImportItemResult {
    /// Opaque identity matching the request.
    pub source_key: ImportKey,
    /// Whether the item was newly created, retained, or failed.
    pub outcome: ImportOutcome,
    /// Sanitized failure category, present only when failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<ImportErrorCode>,
    /// Created or recovered identity, including when only TOTP failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<ItemId>,
}

/// Fixed per-item outcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordImportOutcome)]
pub enum ImportOutcome {
    /// Created in this request.
    Created,
    /// Recovered or retained from an earlier request.
    AlreadyPresent,
    /// Retry or fix this item using its error code.
    Failed,
}

/// Source-to-vault folder identity without display names.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordImportFolderResult)]
pub struct ImportFolderResult {
    /// Opaque source identity.
    pub key: ImportKey,
    /// Existing or ensured folder identity.
    pub folder_id: Uuid,
}

/// Partial batch success without credential values or display metadata.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordImportBatchResult)]
pub struct ImportBatchResult {
    /// Destination folder; null for the vault root.
    pub target_folder_id: Option<Uuid>,
    /// Ensured source folders, in request order.
    pub folders: Vec<ImportFolderResult>,
    /// One result per input item, in request order.
    pub items: Vec<ImportItemResult>,
}

/// Counts-only record for one completed batch attempt.
#[derive(Clone, Copy)]
pub struct ImportCounts {
    /// Newly completed items.
    pub created: u8,
    /// Retained or recovered items.
    pub already_present: u8,
    /// Failed items, including incomplete TOTP setup.
    pub failed: u8,
    /// Source folders in this batch.
    pub folders: u8,
}

/// Item names to look for before an import, in the body so they stay out of
/// URLs and access logs.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordMatchNames)]
pub struct MatchNames {
    /// Names compared ignoring case and surrounding spaces; at most 500
    /// (`password_import::vault::MAX_IMPORT_MATCH_NAMES`).
    pub names: Vec<String>,
}
