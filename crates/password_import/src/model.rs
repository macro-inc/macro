//! The normalized export. Names, URLs, labels and folders are user content too,
//! so `Debug` on these types prints only kinds, counts and opaque source keys.
use std::collections::BTreeMap;
use std::fmt;

use zeroize::Zeroizing;

/// Export formats this crate reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum SourceFormat {
    /// 1Password `.1pux`: a zip archive holding `export.data`.
    OnePasswordPux,
    /// 1Password 8 CSV export.
    OnePasswordCsv,
    /// Bitwarden unencrypted JSON export.
    BitwardenJson,
    /// Bitwarden CSV export.
    BitwardenCsv,
}

/// Bounds on the work one file may cause.
#[derive(Clone, Debug)]
pub struct Limits {
    /// Largest accepted input file.
    pub max_input_bytes: usize,
    /// Most entries a `.1pux` archive may list.
    pub max_zip_entries: usize,
    /// Most bytes `export.data` may inflate to; enforced while inflating.
    pub max_decompressed_bytes: u64,
    /// Most items an export may contain, imported or not.
    pub max_items: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 50 * 1024 * 1024,
            max_zip_entries: 10_000,
            max_decompressed_bytes: 100 * 1024 * 1024,
            max_items: 20_000,
        }
    }
}

/// Item template, matching the vault's item kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum ItemKind {
    /// Website or application login.
    Login,
    /// Payment card.
    Card,
    /// Private note.
    Note,
    /// Identity document.
    Identity,
    /// API credential or SSH key.
    Api,
    /// Standalone verification code. Exports never produce it today; it is
    /// here so the kind set matches the vault's.
    VerificationCode,
}

/// Sensitive text: zeroized on drop, `Debug` prints `Secret(..)`, no `Display`.
#[derive(Default)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub(crate) fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    /// Join the non-empty parts with `separator` without leaving unzeroized
    /// copies behind from buffer growth.
    pub(crate) fn join<'a>(parts: impl IntoIterator<Item = &'a str>, separator: &str) -> Self {
        let parts: Vec<&str> = parts.into_iter().filter(|part| !part.is_empty()).collect();
        let capacity = parts.iter().map(|part| part.len() + separator.len()).sum();
        let mut joined = Zeroizing::new(String::with_capacity(capacity));

        for (index, part) in parts.iter().enumerate() {
            if index > 0 {
                joined.push_str(separator);
            }
            joined.push_str(part);
        }

        Self(joined)
    }

    /// The plain value, for the code that hands it to the vault.
    pub fn expose_secret(&self) -> &str {
        &self.0
    }

    /// Whether the value is empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Secret(..)")
    }
}

impl<'de> serde::Deserialize<'de> for Secret {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(Self::new)
    }
}

#[cfg(feature = "serde")]
impl serde::Serialize for Secret {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// A TOTP seed with default parameters (SHA1, 6 digits, 30 s): uppercase
/// base32 without spaces or padding.
#[derive(Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(transparent))]
pub struct TotpSeed(pub(crate) Secret);

impl TotpSeed {
    /// The base32 seed.
    pub fn expose_secret(&self) -> &str {
        self.0.expose_secret()
    }
}

/// Where an item came from: a 1Password item uuid, a Bitwarden id, or
/// `row:<n>` (1-based data row) for CSV. Opaque and never secret, so it is
/// safe to show in `Debug` and to derive vault ids from.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(transparent))]
pub struct SourceKey(String);

impl SourceKey {
    const MAX_LEN: usize = 128;

    /// A source id if it looks like one (ASCII letters, digits, `-`, `_`, at
    /// most 128 bytes); anything else might be content and is refused.
    pub(crate) fn from_source_id(id: &str) -> Option<Self> {
        let valid = !id.is_empty()
            && id.len() <= Self::MAX_LEN
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');

        valid.then(|| Self(id.to_owned()))
    }

    /// Key for the `index`th item (0-based) of a source without usable ids.
    pub(crate) fn from_item_index(index: usize) -> Self {
        Self(format!("item:{}", index + 1))
    }

    /// Key for the `index`th CSV data row (0-based).
    pub(crate) fn from_row_index(index: usize) -> Self {
        Self(format!("row:{}", index + 1))
    }

    /// The key text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A folder path, outermost first. Each segment is trimmed, non-empty and at
/// most 200 bytes, like a vault folder name.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(transparent))]
pub struct FolderPath(Vec<String>);

impl FolderPath {
    /// The vault's folder name limit.
    pub const MAX_SEGMENT_BYTES: usize = 200;

    /// Validate segments; blank ones are dropped (`a//b` is `a/b`). `Ok(None)`
    /// when nothing is left.
    pub(crate) fn new<'a>(
        segments: impl IntoIterator<Item = &'a str>,
    ) -> Result<Option<Self>, SegmentTooLong> {
        let mut path = Vec::new();

        for segment in segments {
            let segment = segment.trim();

            if segment.is_empty() {
                continue;
            }
            if segment.len() > Self::MAX_SEGMENT_BYTES {
                return Err(SegmentTooLong);
            }

            path.push(segment.to_owned());
        }

        Ok((!path.is_empty()).then_some(Self(path)))
    }

    /// Segments, outermost first.
    pub fn segments(&self) -> &[String] {
        &self.0
    }

    /// This path and each of its ancestors.
    pub(crate) fn with_ancestors(&self) -> impl Iterator<Item = Self> + '_ {
        (1..=self.0.len()).filter_map(|depth| self.0.get(..depth).map(|path| Self(path.to_vec())))
    }
}

/// A folder segment over [`FolderPath::MAX_SEGMENT_BYTES`]; the item is
/// skipped rather than filed elsewhere.
#[derive(Clone, Copy)]
pub(crate) struct SegmentTooLong;

impl fmt::Debug for FolderPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "FolderPath(depth {})", self.0.len())
    }
}

/// A labeled custom field.
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ImportedField {
    /// Field label, non-empty and at most 200 bytes.
    pub label: String,
    /// Field value, non-empty and at most 64 KiB.
    pub value: Secret,
    /// Whether the vault hides the value until revealed.
    pub concealed: bool,
}

impl fmt::Debug for ImportedField {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ImportedField")
            .field("concealed", &self.concealed)
            .finish_non_exhaustive()
    }
}

/// One item ready for the vault; every value is already within vault limits.
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ImportedItem {
    /// Where the item came from.
    pub source_key: SourceKey,
    /// Vault template.
    pub kind: ItemKind,
    /// Display name, non-empty and at most 200 bytes; `Untitled` when blank.
    pub name: String,
    /// The first http(s) URL with a host and no credentials.
    pub url: Option<String>,
    /// Username, cardholder, full name or public key, by kind.
    pub username: Secret,
    /// Password, card number or private credential, by kind.
    pub password: Secret,
    /// Free-form notes.
    pub notes: Secret,
    /// Custom and template fields (`Expires`, `Email`, ...), at most 50. Source
    /// tags arrive here as one `Tags` field, since the vault has no tags.
    pub fields: Vec<ImportedField>,
    /// Verification-code seed.
    pub totp: Option<TotpSeed>,
    /// Source folder, relative to the import's target folder.
    pub folder: Option<FolderPath>,
    /// Whether the source marked it a favorite.
    pub favorite: bool,
}

impl fmt::Debug for ImportedItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ImportedItem")
            .field("source_key", &self.source_key)
            .field("kind", &self.kind)
            .field("has_url", &self.url.is_some())
            .field("fields", &self.fields.len())
            .field("has_totp", &self.totp.is_some())
            .field("folder", &self.folder)
            .field("favorite", &self.favorite)
            .finish_non_exhaustive()
    }
}

/// Why a whole item was not imported.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum SkipReason {
    /// In the source's trash.
    Trashed,
    /// Archived in the source.
    Archived,
    /// A 1Password Document: the file itself is the item.
    Attachment,
    /// Holds only a passkey, which the vault can't store.
    Passkey,
    /// Belongs to a Bitwarden organization or collection.
    SharedCollection,
    /// A category or type with no vault equivalent.
    UnsupportedCategory,
    /// A name, value, field or folder over the vault's limits.
    TooLarge,
    /// The item's shape doesn't match the format.
    Malformed,
}

/// An item that was not imported.
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Skipped {
    /// Source key, when the item had a usable one.
    pub source_key: Option<SourceKey>,
    /// Display name, when it was readable and within limits.
    pub name: Option<String>,
    /// Why it was skipped.
    pub reason: SkipReason,
}

impl fmt::Debug for Skipped {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Skipped")
            .field("source_key", &self.source_key)
            .field("reason", &self.reason)
            .finish_non_exhaustive()
    }
}

/// A part of an imported item that was not carried over as-is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum DroppedPart {
    /// A file attachment.
    Attachment,
    /// A passkey.
    Passkey,
    /// Previous passwords.
    PasswordHistory,
    /// A one-time-password secret that isn't SHA1/6 digits/30 s, or a second
    /// one: kept as a concealed `One-time password` field, not as the code.
    TotpNonDefault,
    /// A field with no vault equivalent, such as a link to another field.
    ExtraField,
}

/// Parts of one imported item that were dropped or downgraded.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Dropped {
    /// The imported item.
    pub source_key: SourceKey,
    /// What was dropped.
    pub what: DroppedPart,
    /// How many.
    pub count: usize,
}

/// The parsed file.
#[derive(Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ParsedExport {
    /// The format that was read.
    pub format: SourceFormat,
    /// Folders used by imported items, unique, parents before children.
    pub folders: Vec<FolderPath>,
    /// Items to import.
    pub items: Vec<ImportedItem>,
    /// Whole items not imported.
    pub skipped: Vec<Skipped>,
    /// Parts of imported items not carried over.
    pub dropped: Vec<Dropped>,
}

/// Counts for the import preview.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Summary {
    /// Imported items per kind.
    pub items_by_kind: BTreeMap<ItemKind, usize>,
    /// Number of folders, ancestors included.
    pub folders: usize,
    /// Skipped items per reason.
    pub skipped_by_reason: BTreeMap<SkipReason, usize>,
    /// Dropped parts per kind of part, summed over items.
    pub dropped_by_part: BTreeMap<DroppedPart, usize>,
}

impl ParsedExport {
    /// Counts for the preview.
    pub fn summary(&self) -> Summary {
        let mut items_by_kind = BTreeMap::new();
        for item in &self.items {
            *items_by_kind.entry(item.kind).or_insert(0) += 1;
        }

        let mut skipped_by_reason = BTreeMap::new();
        for skipped in &self.skipped {
            *skipped_by_reason.entry(skipped.reason).or_insert(0) += 1;
        }

        let mut dropped_by_part = BTreeMap::new();
        for dropped in &self.dropped {
            *dropped_by_part.entry(dropped.what).or_insert(0) += dropped.count;
        }

        Summary {
            items_by_kind,
            folders: self.folders.len(),
            skipped_by_reason,
            dropped_by_part,
        }
    }
}
