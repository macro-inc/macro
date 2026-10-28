//! Mailbox-scoped address-book snapshots. Contact deletion is distinct from
//! deleting the app's correspondence history for an email address.

use super::{ProviderId, StreamPosition};

#[derive(Debug, Clone)]
/// A complete enumeration of the user's personal contact folders.
pub struct ContactFolderCatalog {
    /// Folders with independent contact change streams.
    pub folders: Vec<ProviderId>,
    /// An empty default folder may not expose its ID yet. Keep a previously
    /// discovered default stream until the provider explicitly removes it.
    pub default_folder: Option<ProviderId>,
}

#[derive(Debug, Clone)]
/// One saved contact, which can contribute several email addresses.
pub struct AddressBookContact {
    /// Folder-scoped provider identity.
    pub id: ProviderId,
    /// User-maintained display name.
    pub name: Option<String>,
    /// Normalized email addresses for this entry.
    pub emails: Vec<String>,
}

#[derive(Debug, Clone)]
/// One atomic unit of address-book synchronization.
pub struct AddressBookPage {
    /// Current contact snapshots.
    pub contacts: Vec<AddressBookContact>,
    /// Entries deleted from this folder.
    pub removed: Vec<ProviderId>,
    /// Opaque continuation or completed checkpoint.
    pub position: StreamPosition,
}

/// Raster image bytes downloaded with mailbox authorization. Provider URLs and
/// bearer tokens are never exposed as public avatar URLs.
pub struct ContactPhoto {
    /// Downloaded image content, bounded by the provider adapter.
    pub bytes: Vec<u8>,
    /// Validated raster MIME type.
    pub content_type: String,
}
