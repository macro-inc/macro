//! Presentation files kept as document versions: the newest version's bytes
//! in the document storage bucket, and new versions written the way the
//! storage service's `simple_save` writes them.

use crate::domain::presentation::PresentationFiles;
use anyhow::Context;
use aws_sdk_s3::primitives::ByteStream;
use model::document::FileType;
use s3_key::build_cloud_storage_bucket_document_key;
use sqlx::PgPool;

const PPTX_MIME: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// Reads and writes presentation versions through Postgres and S3.
#[derive(Clone)]
pub struct S3PresentationFiles {
    db: PgPool,
    s3: aws_sdk_s3::Client,
    bucket: String,
}

impl S3PresentationFiles {
    /// Construct the adapter over the document storage bucket.
    pub fn new(db: PgPool, s3: aws_sdk_s3::Client, bucket: impl Into<String>) -> Self {
        Self {
            db,
            s3,
            bucket: bucket.into(),
        }
    }
}

#[async_trait::async_trait]
impl PresentationFiles for S3PresentationFiles {
    #[tracing::instrument(err, skip(self))]
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        let document = macro_db_client::document::get_basic_document(&self.db, document_id)
            .await
            .context("loading the document")?;
        anyhow::ensure!(
            document.file_type.as_deref() == Some(FileType::Pptx.as_str()),
            "the document is not a PowerPoint (.pptx) presentation"
        );
        let (version, _) =
            macro_db_client::document::get_latest_document_version_id(&self.db, document_id)
                .await
                .context("finding the latest version")?;
        let key = build_cloud_storage_bucket_document_key(&document.owner, document_id, version);
        let object = self
            .s3
            .get_object()
            .bucket(&self.bucket)
            .key(&key)
            .send()
            .await
            .context("reading the presentation file")?;
        Ok(object
            .body
            .collect()
            .await
            .context("downloading the presentation file")?
            .into_bytes()
            .to_vec())
    }

    #[tracing::instrument(err, skip(self, bytes), fields(bytes = bytes.len()))]
    async fn write(&self, document_id: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        let saved = macro_db_client::document::save_document(
            &self.db,
            document_id,
            FileType::Pptx,
            Some(""),
            None,
            None,
        )
        .await
        .context("recording the new version")?;
        let key = build_cloud_storage_bucket_document_key(
            &saved.owner,
            &saved.document_id,
            saved.document_version_id,
        );
        let upload = self
            .s3
            .put_object()
            .bucket(&self.bucket)
            .key(&key)
            .content_type(PPTX_MIME)
            .body(ByteStream::from(bytes))
            .send()
            .await;
        if let Err(error) = upload {
            // Never leave a version that has no file behind.
            if let Err(cleanup) = macro_db_client::document::delete_document_version(
                &self.db,
                document_id,
                saved.document_version_id,
                FileType::Pptx.as_str(),
            )
            .await
            {
                tracing::error!(error = ?cleanup, "unable to remove the version whose upload failed");
            }
            return Err(anyhow::Error::new(error).context("uploading the presentation file"));
        }
        Ok(())
    }
}
