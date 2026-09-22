use anyhow::Context;
use model_owner::Owner;

/// The file name used for converted DOCX-to-PDF documents.
pub const CONVERTED_DOCUMENT_FILE_NAME: &str = "converted";

/// The prefix used for temporary files in S3.
pub const TEMP_FILE_PREFIX: &str = "temp_files";

/// The prefix used for sync-service CRDT snapshot cache objects in the document
/// storage bucket. Snapshot keys are `{SYNC_SERVICE_SNAPSHOT_PREFIX}/{document_id}`.
pub const SYNC_SERVICE_SNAPSHOT_PREFIX: &str = "sync_service_snapshot";

/// The file extension for PDF files.
pub const PDF_EXTENSION: &str = "pdf";

/// The file extension for DOCX files.
pub const DOCX_EXTENSION: &str = "docx";

/// Represents an S3 key in the document storage bucket.
///
/// Covers all known key shapes:
/// - `Versioned`: `{owner}/{document_id}/{version_id}` — a specific document version
/// - `ConvertedPdf`: `{owner}/{document_id}/converted.pdf` — a DOCX converted to PDF
/// - `TempDocx`: `temp_files/{document_id}.docx` — a temporary DOCX export
/// - `SyncServiceSnapshot`: `sync_service_snapshot/{document_id}` — a cached CRDT snapshot
/// - `BomPart`: `{sha}` — a content-addressable BOM part from DOCX uploads
///
/// `{owner}` is the owner segment: the owning principal's string as
/// [`owner_segment`] builds it.
#[derive(Eq, PartialEq, Debug, Clone)]
pub enum DocumentKey {
    /// A versioned document: `{owner}/{document_id}/{version_id}`
    Versioned {
        /// The owner segment, an owner principal string.
        owner_segment: String,
        /// The document ID.
        document_id: String,
        /// The document version ID (document_instance_id or document_bom_id).
        version_id: i64,
    },
    /// A DOCX file converted to PDF: `{owner}/{document_id}/converted.pdf`
    ConvertedPdf {
        /// The owner segment, an owner principal string.
        owner_segment: String,
        /// The document ID.
        document_id: String,
    },
    /// A temporary DOCX export: `temp_files/{document_id}.docx`
    TempDocx {
        /// The document ID.
        document_id: String,
    },
    /// A sync-service CRDT snapshot cache object: `sync_service_snapshot/{document_id}`.
    SyncServiceSnapshot {
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

/// Builds the owner segment of a document key.
///
/// This is the one place that decides how an owner is spelled inside an object
/// key. The segment is the owner's principal string verbatim: `macro|<email>`
/// for a user, `bot|<uuid>` for a bot, and a hyphenated UUID for a team.
/// Nothing is percent-encoded: every object written so far sits under the raw
/// user principal and must stay addressable, and bot and team principals use a
/// subset of the characters a user principal already uses.
///
/// A key is not a URL. Code that places a key in a URL path encodes the whole
/// key with [`document_key_url_path`] at that point rather than encoding the
/// owner here.
fn owner_segment(owner: &Owner) -> String {
    owner.principal_id()
}

/// Reads the owner segment of a key back into an owner principal string.
///
/// Exact inverse of [`owner_segment`]: the segment is taken verbatim, so
/// [`DocumentKey::to_key`] reproduces the parsed key byte for byte. Nothing is
/// percent-decoded here; `%` is a legal character in a user principal's email,
/// so decoding would turn one owner into another. A listener that receives
/// form-encoded keys (classic S3 event notifications, unlike EventBridge)
/// decodes the whole key at its inbound boundary before parsing.
fn parse_owner_segment(segment: &str) -> String {
    segment.to_string()
}

impl DocumentKey {
    /// Parses an S3 key from the document storage bucket into a `DocumentKey`.
    ///
    /// The key must be the object key as stored, not a form-encoded copy from
    /// an event notification; see [`parse_owner_segment`].
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
            2 if split[0] == SYNC_SERVICE_SNAPSHOT_PREFIX => Ok(Self::SyncServiceSnapshot {
                document_id: split[1].to_string(),
            }),
            3 => {
                let owner_segment = parse_owner_segment(split[0]);
                let document_id = split[1].to_string();
                let tail = split[2];

                let converted_pdf_suffix =
                    format!("{CONVERTED_DOCUMENT_FILE_NAME}.{PDF_EXTENSION}");
                if tail == converted_pdf_suffix {
                    Ok(Self::ConvertedPdf {
                        owner_segment,
                        document_id,
                    })
                } else {
                    let version_id: i64 = tail.parse().context(format!(
                        "invalid version id: expected integer, got '{tail}'"
                    ))?;
                    Ok(Self::Versioned {
                        owner_segment,
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
            | Self::TempDocx { document_id }
            | Self::SyncServiceSnapshot { document_id } => Some(document_id),
            Self::BomPart { .. } => None,
        }
    }

    /// Returns the owner segment for the key shapes that carry one.
    pub fn owner_segment(&self) -> Option<&str> {
        match self {
            Self::Versioned { owner_segment, .. } | Self::ConvertedPdf { owner_segment, .. } => {
                Some(owner_segment)
            }
            Self::TempDocx { .. } | Self::SyncServiceSnapshot { .. } | Self::BomPart { .. } => None,
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

    /// Returns `true` if this is a sync-service snapshot cache key.
    pub fn is_sync_service_snapshot(&self) -> bool {
        matches!(self, Self::SyncServiceSnapshot { .. })
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
            Self::TempDocx { .. } | Self::SyncServiceSnapshot { .. } | Self::BomPart { .. } => None,
        }
    }

    /// Reconstructs the S3 key string.
    pub fn to_key(&self) -> String {
        match self {
            Self::Versioned {
                owner_segment,
                document_id,
                version_id,
            } => build_document_key_from_segment(owner_segment, document_id, version_id, None),
            Self::ConvertedPdf {
                owner_segment,
                document_id,
            } => build_document_key_from_segment(
                owner_segment,
                document_id,
                CONVERTED_DOCUMENT_FILE_NAME,
                Some(PDF_EXTENSION),
            ),
            Self::TempDocx { document_id } => build_temp_docx_key(document_id),
            Self::SyncServiceSnapshot { document_id } => {
                format!("{SYNC_SERVICE_SNAPSHOT_PREFIX}/{document_id}")
            }
            Self::BomPart { sha } => sha.clone(),
        }
    }
}

/// Joins an already-built owner segment with the rest of a document key.
///
/// Every `{owner}/{document_id}/...` key goes through here so the layout lives
/// in one place; only [`owner_segment`] and [`DocumentKey::to_key`] hand it a
/// segment.
fn build_document_key_from_segment<T: ToString>(
    owner_segment: &str,
    document_id: &str,
    document_version_id: T,
    file_type: Option<&str>,
) -> String {
    let prefix = build_document_prefix_from_segment(owner_segment, document_id);
    match file_type {
        Some(file_type) => {
            format!("{prefix}/{}.{file_type}", document_version_id.to_string())
        }
        None => format!("{prefix}/{}", document_version_id.to_string()),
    }
}

fn build_document_prefix_from_segment(owner_segment: &str, document_id: &str) -> String {
    format!("{owner_segment}/{document_id}")
}

/// Builds a document key for a document in the cloud storage bucket.
/// The format is `{owner}/{document_id}/{document_version_id}`.
pub fn build_cloud_storage_bucket_document_key<T: ToString>(
    owner: &Owner,
    document_id: &str,
    document_version_id: T,
) -> String {
    build_document_key_from_segment(
        &owner_segment(owner),
        document_id,
        document_version_id,
        None,
    )
}

/// Builds the key prefix shared by every object of one document in the cloud
/// storage bucket: `{owner}/{document_id}`. Use it to list or delete a
/// document's objects.
pub fn build_cloud_storage_bucket_document_prefix(owner: &Owner, document_id: &str) -> String {
    build_document_prefix_from_segment(&owner_segment(owner), document_id)
}

/// Builds the S3 key for a converted DOCX document's PDF output.
/// Format: `{owner}/{document_id}/converted.pdf`
pub fn build_docx_to_pdf_converted_document_key(owner: &Owner, document_id: &str) -> String {
    build_document_key_from_segment(
        &owner_segment(owner),
        document_id,
        CONVERTED_DOCUMENT_FILE_NAME,
        Some(PDF_EXTENSION),
    )
}

/// Builds the S3 key for a DOCX document's staging bucket.
/// Format: `{owner}/{document_id}/{document_version_id}.docx`
pub fn build_docx_staging_bucket_document_key(
    owner: &Owner,
    document_id: &str,
    document_version_id: i64,
) -> String {
    build_document_key_from_segment(
        &owner_segment(owner),
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

/// Percent-encodes a document key for use as a URL path.
///
/// Each `/`-separated segment is encoded on its own so the separators survive.
/// Object keys are never stored encoded (see [`owner_segment`]); this is only
/// for building a URL by hand, such as a CloudFront signed URL or an S3 copy
/// source, where `|` and `@` in a user principal are not path-safe. Document
/// IDs and version segments contain only unreserved characters, so for a
/// user-owned key this changes exactly the owner segment.
pub fn document_key_url_path(key: &str) -> String {
    key.split('/')
        .map(urlencoding::encode)
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod test;
