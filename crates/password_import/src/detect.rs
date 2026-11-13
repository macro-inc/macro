use crate::bitwarden_json::Envelope;
use crate::error::ImportError;
use crate::model::{Limits, SourceFormat};
use crate::{bitwarden_csv, csv_table, one_password_csv, zip_archive};

/// Sniff the format: a zip holding `export.data`, a Bitwarden JSON export, or
/// a CSV with a known header. Checks the same file-level limits as [`crate::parse`]
/// with the same `limits`, without inflating or parsing items.
pub fn detect(bytes: &[u8], limits: &Limits) -> Result<SourceFormat, ImportError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(ImportError::TooLarge);
    }

    if bytes.starts_with(zip_archive::ZIP_MAGIC) {
        zip_archive::open_checked(bytes, limits)?;
        return Ok(SourceFormat::OnePasswordPux);
    }

    let text = crate::strip_byte_order_mark(bytes);
    if text.trim_ascii_start().starts_with(b"{") {
        let envelope: Envelope =
            serde_json::from_slice(text).map_err(|error| ImportError::json(&error))?;

        return match envelope {
            Envelope {
                encrypted: Some(true),
                ..
            } => Err(ImportError::EncryptedBitwarden),
            Envelope { items: Some(_), .. } => Ok(SourceFormat::BitwardenJson),
            Envelope { items: None, .. } => Err(ImportError::UnknownFormat),
        };
    }

    let Some(headers) = csv_table::headers(bytes) else {
        return Err(ImportError::UnknownFormat);
    };

    if csv_table::has_columns(&headers, &bitwarden_csv::REQUIRED_COLUMNS) {
        Ok(SourceFormat::BitwardenCsv)
    } else if one_password_csv::is_one_password_7(&headers) {
        Err(ImportError::UnsupportedVersion)
    } else if csv_table::has_columns(&headers, &one_password_csv::REQUIRED_COLUMNS) {
        Ok(SourceFormat::OnePasswordCsv)
    } else {
        Err(ImportError::UnknownFormat)
    }
}
