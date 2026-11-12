/// Why a whole file can't be imported. Carries positions and nothing from
/// the file's content.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(
    feature = "serde",
    serde(
        tag = "code",
        rename_all = "snake_case",
        rename_all_fields = "camelCase"
    )
)]
pub enum ImportError {
    /// Not a 1Password or Bitwarden export this crate reads.
    #[error("the file is not a recognized 1Password or Bitwarden export")]
    UnknownFormat,
    /// Larger than [`crate::Limits::max_input_bytes`].
    #[error("the file is larger than the import limit")]
    TooLarge,
    /// `export.data` inflates past [`crate::Limits::max_decompressed_bytes`].
    #[error("the archive inflates past the import limit")]
    ZipBomb,
    /// More archive entries than [`crate::Limits::max_zip_entries`].
    #[error("the archive has too many entries")]
    TooManyEntries,
    /// More items than [`crate::Limits::max_items`].
    #[error("the export has too many items")]
    TooManyItems,
    /// An archive entry name with `..`, an absolute path or a backslash.
    #[error("the archive has an unsafe entry name")]
    PathTraversal,
    /// Not a readable zip archive, or `export.data` is encrypted or uses an
    /// unsupported compression method.
    #[error("the archive is not a readable zip file")]
    InvalidZip,
    /// A zip archive without `export.data`.
    #[error("the archive has no export.data entry")]
    MissingExportData,
    /// A password-protected or account-encrypted Bitwarden export.
    #[error("the Bitwarden export is encrypted")]
    EncryptedBitwarden,
    /// Not valid JSON, or not the expected shape, at `line` (1-based).
    #[error("invalid JSON at line {line}")]
    InvalidJson {
        /// 1-based line of the error.
        line: usize,
    },
    /// Not valid CSV, or missing required columns, at `row` (1-based, header
    /// is row 1).
    #[error("invalid CSV at row {row}")]
    InvalidCsv {
        /// 1-based row of the error.
        row: usize,
    },
    /// Valid JSON in a layout this crate doesn't read.
    #[error("unsupported export version")]
    UnsupportedVersion,
}

impl ImportError {
    pub(crate) fn json(error: &serde_json::Error) -> Self {
        Self::InvalidJson { line: error.line() }
    }
}
