//! Parse 1Password and Bitwarden exports into items the team vault accepts.
//!
//! Pure and total: no I/O, no logging, and every input yields a value or a
//! typed [`ImportError`], never a panic. Values live only in [`Secret`].
#![deny(missing_docs)]

mod bitwarden_csv;
mod bitwarden_json;
mod detect;
mod draft;
mod error;
mod model;
mod one_password_csv;
mod one_password_pux;
mod csv_table;
mod totp;
mod zip_archive;

pub use detect::detect;
pub use error::ImportError;
pub use model::{
    Dropped, DroppedPart, FolderPath, ImportedField, ImportedItem, ItemKind, Limits,
    ParsedExport, Secret, SkipReason, Skipped, SourceFormat, SourceKey, Summary, TotpSeed,
};

/// Parse `bytes` as `format`. Items that can't be imported are reported in
/// [`ParsedExport::skipped`]; only problems with the file as a whole are errors.
pub fn parse(
    bytes: &[u8],
    format: SourceFormat,
    limits: &Limits,
) -> Result<ParsedExport, ImportError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(ImportError::TooLarge);
    }

    let parts = match format {
        SourceFormat::OnePasswordPux => one_password_pux::parse(bytes, limits)?,
        SourceFormat::OnePasswordCsv => one_password_csv::parse(bytes, limits)?,
        SourceFormat::BitwardenJson => bitwarden_json::parse(bytes, limits)?,
        SourceFormat::BitwardenCsv => bitwarden_csv::parse(bytes, limits)?,
    };

    Ok(parts.into_export(format))
}
