//! DOCX export persistence using the primary database and immutable S3 objects.

use std::io::{Cursor, Write};

use documents_hex::domain::docx_export::DocxExportStore;
use model::document::BomPart;
use s3_key::document_key_url_path;
use sha2::{Digest, Sha256};

use crate::api::context::ApiContext;
use crate::service::cloudfront::{get_cloudfront_signed_options, get_presigned_url};
use crate::service::s3::S3;

#[derive(Debug, thiserror::Error)]
pub enum DocxExportError {
    #[error("unable to read or export document parts")]
    Storage(#[from] anyhow::Error),
}

/// The version's paths and content hashes identify both the stored archive and
/// the CDN URL. Old document-id-only exports may contain an empty ZIP.
fn export_key(document_id: &str, parts: &[BomPart]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.path.len() as u64).to_be_bytes());
        hash.update(part.path.as_bytes());
        hash.update((part.sha.len() as u64).to_be_bytes());
        hash.update(part.sha.as_bytes());
    }
    // Keep the two-segment temporary-file shape so storage event consumers
    // classify this as an export rather than a new document upload.
    format!("temp_files/{document_id}-{:x}.docx", hash.finalize())
}

#[tracing::instrument(skip_all, fields(document_id = %document_id, part_count = parts.len(), cache_hit), err)]
async fn store_export(
    s3: &S3,
    document_id: &str,
    mut parts: Vec<BomPart>,
) -> anyhow::Result<String> {
    parts.sort_by(|a, b| a.path.cmp(&b.path));
    let key = export_key(document_id, &parts);
    let exists = s3.exists(&key).await?;
    tracing::Span::current().record("cache_hit", exists);
    if !exists {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for part in parts {
            let content = s3.get_document(&part.sha).await?;
            zip.start_file::<_, ()>(part.path, zip::write::FileOptions::default())?;
            zip.write_all(&content)?;
        }
        s3.upload_document(&key, zip.finish()?.into_inner()).await?;
    }
    Ok(key)
}

impl DocxExportStore for ApiContext {
    type Err = DocxExportError;

    #[tracing::instrument(skip_all, fields(document_id = %document_id), err)]
    async fn parts(&self, document_id: &str) -> Result<Vec<BomPart>, Self::Err> {
        Ok(macro_db_client::document::get_document_bom(self.db.clone(), document_id).await?)
    }

    #[tracing::instrument(skip_all, fields(document_id = %document_id), err)]
    async fn export_parts(
        &self,
        document_id: &str,
        parts: Vec<BomPart>,
    ) -> Result<String, Self::Err> {
        let key = store_export(&self.s3_client, document_id, parts).await?;
        let signed_options = get_cloudfront_signed_options(
            &self
                .config
                .document_storage_service_cloudfront_signer_public_key_id,
            self.config
                .document_storage_service_cloudfront_signer_private_key
                .as_ref(),
            self.config
                .document_storage_service_presigned_url_expiry_seconds,
        )?;
        Ok(get_presigned_url(
            &self
                .config
                .document_storage_service_cloudfront_distribution_url,
            &document_key_url_path(&key),
            &signed_options,
        )?)
    }
}

#[cfg(test)]
mod test;
