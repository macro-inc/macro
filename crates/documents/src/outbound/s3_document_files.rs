//! Files of single-file documents kept as document versions: the newest
//! version's bytes in the document storage bucket, and new versions written
//! the way the storage service's `simple_save` writes them. Presentations
//! are read and written; designs, Photoshop documents, and Illustrator
//! documents are read. Word documents are stored as extracted parts and read
//! back as the archive the storage service exports.

use crate::domain::design::DesignFiles;
use crate::domain::illustrator::IllustratorFiles;
use crate::domain::photoshop::PhotoshopFiles;
use crate::domain::presentation::PresentationFiles;
use crate::domain::word_document::WordDocumentFiles;
use anyhow::Context;
use aws_sdk_s3::primitives::ByteStream;
use futures::{StreamExt, TryStreamExt};
use model::document::FileType;
use pptx_engine::zip::{WriteData, Writer};
use s3_key::build_cloud_storage_bucket_document_key;
use sqlx::PgPool;

const PPTX_MIME: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// Word parts downloaded at once.
const PART_DOWNLOADS: usize = 8;

/// Reads and writes document versions through Postgres and S3.
#[derive(Clone)]
pub struct S3DocumentFiles {
    db: PgPool,
    s3: aws_sdk_s3::Client,
    bucket: String,
}

impl S3DocumentFiles {
    /// Construct the adapter over the document storage bucket.
    pub fn new(db: PgPool, s3: aws_sdk_s3::Client, bucket: impl Into<String>) -> Self {
        Self {
            db,
            s3,
            bucket: bucket.into(),
        }
    }

    /// The bytes of one stored object.
    async fn object(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        let object = self
            .s3
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;
        Ok(object.body.collect().await?.into_bytes().to_vec())
    }

    /// The latest version's bytes of a document of one of the `expected`
    /// types.
    async fn read_latest(
        &self,
        document_id: &str,
        expected: &[FileType],
        kind: &str,
    ) -> anyhow::Result<Vec<u8>> {
        let document = macro_db_client::document::get_basic_document(&self.db, document_id)
            .await
            .context("loading the document")?;
        anyhow::ensure!(
            expected
                .iter()
                .any(|file_type| document.file_type.as_deref() == Some(file_type.as_str())),
            "the document is not a {kind}"
        );
        let (version, _) =
            macro_db_client::document::get_latest_document_version_id(&self.db, document_id)
                .await
                .context("finding the latest version")?;
        let key = build_cloud_storage_bucket_document_key(&document.owner, document_id, version);
        self.object(&key)
            .await
            .with_context(|| format!("reading the {kind} file"))
    }
}

#[async_trait::async_trait]
impl WordDocumentFiles for S3DocumentFiles {
    /// The parts the upload worker extracted, zipped in path order as the
    /// storage service's export zips them.
    #[tracing::instrument(err, skip(self), fields(part_count))]
    async fn original(&self, document_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let mut parts = macro_db_client::document::get_document_bom(self.db.clone(), document_id)
            .await
            .context("loading the Word document's parts")?;
        tracing::Span::current().record("part_count", parts.len());
        if parts.is_empty() {
            return Ok(None);
        }
        parts.sort_by(|a, b| a.path.cmp(&b.path));
        let keys: Vec<String> = parts.iter().map(|part| part.sha.clone()).collect();
        let contents: Vec<Vec<u8>> = futures::stream::iter(keys)
            .map(|key| async move { self.object(&key).await })
            .buffered(PART_DOWNLOADS)
            .try_collect()
            .await
            .context("reading the Word document's parts")?;
        let mut zip = Writer::new();
        for (part, data) in parts.iter().zip(&contents) {
            zip.add(
                &part.path,
                WriteData::Fresh {
                    data,
                    compress: false,
                },
            )?;
        }
        Ok(Some(zip.finish()?))
    }
}

#[async_trait::async_trait]
impl PresentationFiles for S3DocumentFiles {
    #[tracing::instrument(err, skip(self))]
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        self.read_latest(
            document_id,
            &[FileType::Pptx],
            "PowerPoint (.pptx) presentation",
        )
        .await
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

#[async_trait::async_trait]
impl DesignFiles for S3DocumentFiles {
    #[tracing::instrument(err, skip(self))]
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        self.read_latest(document_id, &[FileType::Fig], "Figma (.fig) design")
            .await
    }
}

#[async_trait::async_trait]
impl PhotoshopFiles for S3DocumentFiles {
    #[tracing::instrument(err, skip(self))]
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        self.read_latest(
            document_id,
            &[FileType::Psd, FileType::Psb],
            "Photoshop (.psd or .psb) document",
        )
        .await
    }
}

#[async_trait::async_trait]
impl IllustratorFiles for S3DocumentFiles {
    #[tracing::instrument(err, skip(self))]
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        self.read_latest(document_id, &[FileType::Ai], "Illustrator (.ai) document")
            .await
    }
}
