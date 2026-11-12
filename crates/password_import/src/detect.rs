use crate::bitwarden_json::Envelope;
use crate::error::ImportError;
use crate::model::{Limits, SourceFormat};
use crate::{bitwarden_csv, csv_table, one_password_csv, zip_archive};

/// Sniff the format: a zip holding `export.data`, a Bitwarden JSON export, or
/// a CSV with a known header. Reads at most what [`Limits::default`] allows.
pub fn detect(bytes: &[u8]) -> Result<SourceFormat, ImportError> {
    let limits = Limits::default();
    if bytes.len() > limits.max_input_bytes {
        return Err(ImportError::TooLarge);
    }

    if bytes.starts_with(zip_archive::ZIP_MAGIC) {
        zip_archive::read_export_data(bytes, &limits)?;
        return Ok(SourceFormat::OnePasswordPux);
    }

    let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
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
    let has_all = |required: &[&str]| {
        required
            .iter()
            .all(|name| headers.iter().any(|header| header == name))
    };

    if has_all(&bitwarden_csv::REQUIRED_COLUMNS) {
        Ok(SourceFormat::BitwardenCsv)
    } else if has_all(&one_password_csv::REQUIRED_COLUMNS) {
        Ok(SourceFormat::OnePasswordCsv)
    } else {
        Err(ImportError::UnknownFormat)
    }
}
