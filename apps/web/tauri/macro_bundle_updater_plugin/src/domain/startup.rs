use serde::Serialize;

/// How startup chose the bundle this launch serves, kept for the frontend to
/// report because native logs never leave the device.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BundleStartup {
    /// The bundle startup selected before the first document loaded.
    pub selection: StartupSelection,
    /// What the persisted bundle selection held.
    pub saved_selection: SavedSelection,
    /// Why startup did not serve the saved OTA bundle.
    pub rejection: Option<BundleRejection>,
    /// I/O error kind of the read behind an unreadable selection or a
    /// rejection, such as `NotFound` or `PermissionDenied`.
    pub read_error: Option<String>,
    /// Numbered bundle directories present before startup cleanup.
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub bundle_dirs_found: usize,
    /// Numbered bundle directories startup cleanup deleted.
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub bundle_dirs_removed: usize,
}

/// The bundle startup selected.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum StartupSelection {
    /// The saved OTA bundle.
    SavedOta,
    /// A completed download, applied before the first document loads.
    CompletedDownload,
    /// The bundle embedded in the native app.
    Embedded,
}

/// What the persisted bundle selection held at startup.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SavedSelection {
    /// No selection was saved: a fresh install, or bundle storage was cleared.
    None,
    /// The selection exists but could not be read.
    Unreadable,
    /// The embedded bundle was explicitly selected.
    Embedded,
    /// An OTA bundle directory was selected.
    Ota,
}

/// Why startup did not serve the saved OTA bundle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum BundleRejection {
    /// Its `index.html` could not be read.
    EntrypointUnreadable,
    /// Its manifest is missing, unparsable, or has no minimum for this platform.
    ManifestInvalid,
    /// Its completion record is missing or names another build.
    ExtractionIncomplete,
    /// It is older than the embedded bundle.
    OlderThanEmbedded,
    /// It requires a newer native build.
    RequiresNewerNative,
}

/// What reading the persisted bundle selection found.
pub(crate) struct SavedSelectionRead {
    pub(crate) selection: SavedSelection,
    pub(crate) rejection: Option<BundleRejection>,
    pub(crate) read_error: Option<std::io::ErrorKind>,
}
