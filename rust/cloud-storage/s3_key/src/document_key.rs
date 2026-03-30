use anyhow::Context;

/// The file name used for converted DOCX-to-PDF documents.
pub const CONVERTED_DOCUMENT_FILE_NAME: &str = "converted";

/// The prefix used for temporary files in S3.
pub const TEMP_FILE_PREFIX: &str = "temp_files";

/// The file extension for PDF files.
pub const PDF_EXTENSION: &str = "pdf";

/// The file extension for DOCX files.
pub const DOCX_EXTENSION: &str = "docx";

/// Represents an S3 key in the document storage bucket.
///
/// Covers all known key shapes:
/// - `Versioned`: `{user_id}/{document_id}/{version_id}` — a specific document version
/// - `ConvertedPdf`: `{user_id}/{document_id}/converted.pdf` — a DOCX converted to PDF
/// - `TempDocx`: `temp_files/{document_id}.docx` — a temporary DOCX export
/// - `BomPart`: `{sha}` — a content-addressable BOM part from DOCX uploads
#[derive(Eq, PartialEq, Debug, Clone)]
pub enum DocumentKey {
    /// A versioned document: `{user_id}/{document_id}/{version_id}`
    Versioned {
        /// The owner's user ID.
        user_id: String,
        /// The document ID.
        document_id: String,
        /// The document version ID (document_instance_id or document_bom_id).
        version_id: i64,
    },
    /// A DOCX file converted to PDF: `{user_id}/{document_id}/converted.pdf`
    ConvertedPdf {
        /// The owner's user ID.
        user_id: String,
        /// The document ID.
        document_id: String,
    },
    /// A temporary DOCX export: `temp_files/{document_id}.docx`
    TempDocx {
        /// The document ID.
        document_id: String,
    },
    /// A content-addressable BOM part from DOCX uploads: `{sha}`
    BomPart {
        /// The SHA hash of the BOM part.
        sha: String,
    },
}

const SHA256_HEX_LEN: usize = 64;

fn is_sha256_hex(s: &str) -> bool {
    s.len() == SHA256_HEX_LEN && s.bytes().all(|b| b.is_ascii_hexdigit())
}

impl DocumentKey {
    /// Parses an S3 key from the document storage bucket into a `DocumentKey`.
    pub fn from_s3_key(key: &str) -> Result<Self, anyhow::Error> {
        let split: Vec<&str> = key.split('/').collect();

        match split.len() {
            2 if split[0] == TEMP_FILE_PREFIX => {
                let filename = split[1];
                let docx_suffix = format!(".{DOCX_EXTENSION}");
                let document_id = filename
                    .strip_suffix(&docx_suffix)
                    .context(format!("expected .docx extension, got '{filename}'"))?;
                Ok(Self::TempDocx {
                    document_id: document_id.to_string(),
                })
            }
            3 => {
                let user_id = urlencoding::decode(split[0]).context("UTF-8")?.into_owned();
                let document_id = split[1].to_string();
                let tail = split[2];

                let converted_pdf_suffix =
                    format!("{CONVERTED_DOCUMENT_FILE_NAME}.{PDF_EXTENSION}");
                if tail == converted_pdf_suffix {
                    Ok(Self::ConvertedPdf {
                        user_id,
                        document_id,
                    })
                } else {
                    let version_id: i64 = tail.parse().context(format!(
                        "invalid version id: expected integer, got '{tail}'"
                    ))?;
                    Ok(Self::Versioned {
                        user_id,
                        document_id,
                        version_id,
                    })
                }
            }
            1 if is_sha256_hex(split[0]) => Ok(Self::BomPart {
                sha: split[0].to_string(),
            }),
            n => anyhow::bail!(
                "invalid key format: expected 2 or 3 segments, got {n} for key '{key}'"
            ),
        }
    }

    /// Returns the document ID for document key variants. Returns `None` for `BomPart`.
    pub fn document_id(&self) -> Option<&str> {
        match self {
            Self::Versioned { document_id, .. }
            | Self::ConvertedPdf { document_id, .. }
            | Self::TempDocx { document_id } => Some(document_id),
            Self::BomPart { .. } => None,
        }
    }

    /// Returns `true` if this is a versioned document key. This is the default.
    pub fn is_versioned(&self) -> bool {
        matches!(self, Self::Versioned { .. })
    }

    /// Returns `true` if this is a temporary DOCX export key.
    pub fn is_temp(&self) -> bool {
        matches!(self, Self::TempDocx { .. })
    }

    /// Returns `true` if this is a BOM part key.
    pub fn is_bom_part(&self) -> bool {
        matches!(self, Self::BomPart { .. })
    }

    /// Returns `true` if this is a converted DOCX-to-PDF key.
    pub fn is_converted_pdf(&self) -> bool {
        matches!(self, Self::ConvertedPdf { .. })
    }

    /// Returns the version ID as a string suitable for `SearchExtractorMessage`.
    ///
    /// - `Versioned` → the integer version ID as a string
    /// - `ConvertedPdf` → `"converted"`
    /// - `TempDocx` → `None`
    pub fn version_id_string(&self) -> Option<String> {
        match self {
            Self::Versioned { version_id, .. } => Some(version_id.to_string()),
            Self::ConvertedPdf { .. } => Some(CONVERTED_DOCUMENT_FILE_NAME.to_string()),
            Self::TempDocx { .. } | Self::BomPart { .. } => None,
        }
    }

    /// Reconstructs the S3 key string.
    pub fn to_key(&self) -> String {
        match self {
            Self::Versioned {
                user_id,
                document_id,
                version_id,
            } => build_cloud_storage_bucket_document_key(user_id, document_id, version_id),
            Self::ConvertedPdf {
                user_id,
                document_id,
            } => build_docx_to_pdf_converted_document_key(user_id, document_id),
            Self::TempDocx { document_id } => build_temp_docx_key(document_id),
            Self::BomPart { sha } => sha.clone(),
        }
    }
}

fn build_cloud_storage_bucket_document_key_helper<T: ToString>(
    user_id: &str,
    document_id: &str,
    document_version_id: T,
    file_type: Option<&str>,
) -> String {
    match file_type {
        Some(file_type) => {
            format!(
                "{}/{}/{}.{}",
                user_id,
                document_id,
                document_version_id.to_string(),
                file_type
            )
        }
        None => {
            format!(
                "{}/{}/{}",
                user_id,
                document_id,
                document_version_id.to_string()
            )
        }
    }
}

/// Builds a document key for a document in the cloud storage bucket.
/// The format is `{user_id}/{document_id}/{document_version_id}`.
pub fn build_cloud_storage_bucket_document_key<T: ToString>(
    user_id: &str,
    document_id: &str,
    document_version_id: T,
) -> String {
    build_cloud_storage_bucket_document_key_helper(user_id, document_id, document_version_id, None)
}

/// Builds the S3 key for a converted DOCX document's PDF output.
/// Format: `{user_id}/{document_id}/converted.pdf`
pub fn build_docx_to_pdf_converted_document_key(user_id: &str, document_id: &str) -> String {
    build_cloud_storage_bucket_document_key_helper(
        user_id,
        document_id,
        CONVERTED_DOCUMENT_FILE_NAME,
        Some(PDF_EXTENSION),
    )
}

/// Builds the S3 key for a DOCX document's staging bucket.
/// Format: `{user_id}/{document_id}/{document_version_id}.docx`
pub fn build_docx_staging_bucket_document_key(
    user_id: &str,
    document_id: &str,
    document_version_id: i64,
) -> String {
    build_cloud_storage_bucket_document_key_helper(
        user_id,
        document_id,
        document_version_id,
        Some(DOCX_EXTENSION),
    )
}

/// Builds the S3 key for a temporary DOCX export file.
/// Format: `temp_files/{document_id}.docx`
pub fn build_temp_docx_key(document_id: &str) -> String {
    format!("{}/{}.{}", TEMP_FILE_PREFIX, document_id, DOCX_EXTENSION)
}

#[cfg(test)]
mod test;
