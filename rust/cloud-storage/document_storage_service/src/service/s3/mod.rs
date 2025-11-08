mod copy_document;
mod delete;
mod exists;
mod get;
mod get_folder;
mod get_presigned_url;
mod put_presigned_url;
mod upload_document;

use std::sync::Arc;

use aws_sdk_s3::{self as s3, primitives::ByteStream};
#[allow(unused_imports)]
use mockall::automock;

#[cfg(test)]
pub use MockS3Client as S3;
#[cfg(not(test))]
pub use S3Client as S3;
use tokio::sync::Semaphore;

use model::document::{ContentType, FileType};

pub static TEMP_FILE_PREFIX: &str = "temp_files/";

#[derive(Clone, Debug)]
pub struct S3Client {
    /// Inner S3 client
    inner: s3::Client,
    document_storage_bucket: String,
    docx_upload_bucket: String,
    upload_staging_bucket: String,
}

#[cfg_attr(test, automock)]
impl S3Client {
    pub fn new(
        inner: s3::Client,
        document_storage_bucket: &str,
        docx_upload_bucket: &str,
        upload_staging_bucket: &str,
    ) -> Self {
        Self {
            inner,
            document_storage_bucket: document_storage_bucket.to_string(),
            docx_upload_bucket: docx_upload_bucket.to_string(),
            upload_staging_bucket: upload_staging_bucket.to_string(),
        }
    }

    pub fn get_document_storage_bucket(&self) -> &str {
        &self.document_storage_bucket
    }

    pub fn get_docx_upload_bucket(&self) -> &str {
        &self.docx_upload_bucket
    }

    pub async fn get_document(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        get::get(&self.inner, &self.document_storage_bucket, key).await
    }

    pub async fn upload_document(&self, key: &str, content: Vec<u8>) -> anyhow::Result<()> {
        let stream = ByteStream::from(content);
        upload_document::upload_document(&self.inner, &self.document_storage_bucket, key, stream)
            .await
    }

    pub async fn put_document_storage_presigned_url(
        &self,
        key: &str,
        sha: &str,
        content_type: ContentType,
    ) -> anyhow::Result<String> {
        put_presigned_url::put_presigned_url(
            &self.inner,
            &self.document_storage_bucket,
            key,
            sha,
            content_type,
        )
        .await
    }

    /// Generates a presigned url for uploading a docx document
    pub async fn put_docx_upload_presigned_url(
        &self,
        key: &str,
        sha: &str,
        content_type: ContentType,
    ) -> anyhow::Result<String> {
        put_presigned_url::put_presigned_url(
            &self.inner,
            &self.docx_upload_bucket,
            key,
            sha,
            content_type,
        )
        .await
    }

    /// Generates a presigned url for uploading a file to the staging bucket
    pub async fn put_upload_zip_staging_presigned_url(
        &self,
        key: &str,
        sha: &str,
    ) -> anyhow::Result<String> {
        put_presigned_url::put_presigned_url(
            &self.inner,
            &self.upload_staging_bucket,
            key,
            sha,
            FileType::Zip.into(),
        )
        .await
    }

    pub async fn copy_document(
        &self,
        source_key: &str,
        destination_key: &str,
    ) -> anyhow::Result<()> {
        copy_document::copy_document(
            &self.inner,
            &self.document_storage_bucket,
            source_key,
            destination_key,
        )
        .await
    }

    /// Deletes all document instances stored under a user's document
    pub async fn delete_document(&self, user_id: &str, document_id: &str) -> anyhow::Result<()> {
        delete::delete_document(
            &self.inner,
            &self.document_storage_bucket,
            user_id,
            document_id,
        )
        .await
    }

    pub async fn exists(&self, key: &str) -> anyhow::Result<bool> {
        exists::exists(&self.inner, &self.document_storage_bucket, key).await
    }

    /// Gets all the keys in a folder
    /// Returns a list of the (file_name, file_type) for each file in the folder
    #[tracing::instrument(skip(self))]
    pub async fn get_folder_content_names(
        &self,
        folder_path: &str,
    ) -> anyhow::Result<Vec<(String, String)>> {
        get_folder::get_folder_content_names(
            &self.inner,
            &self.document_storage_bucket,
            folder_path,
        )
        .await
    }

    pub async fn shas_exist(&self, shas: &Vec<String>) -> anyhow::Result<bool> {
        if shas.is_empty() {
            return Ok(true);
        }
        let semaphore = Arc::new(Semaphore::new(10));

        let mut futures = vec![];
        for sha in shas {
            let semaphore = semaphore.clone(); // Clone the semaphore for each iteration
            let s3_client = self.inner.clone();
            let shared_document_storage_bucket = self.document_storage_bucket.to_string();
            let shared_sha = sha.clone();

            // Create an async block that acquires a permit before spawning the task
            let future = async move {
                let permit = semaphore.acquire_owned().await.unwrap(); // Acquire the semaphore permit
                let result = exists::exists(
                    &s3_client,
                    &shared_document_storage_bucket,
                    shared_sha.as_str(),
                )
                .await;
                drop(permit); // Release the permit after task completes
                (shared_sha.clone(), result)
            };
            futures.push(future);
        }

        let results = futures::future::join_all(futures).await;
        for (sha, result) in results {
            match result {
                Ok(exists) => {
                    if !exists {
                        tracing::error!(sha=?sha, "missing sha");
                        return Ok(false);
                    }
                }
                Err(e) => {
                    tracing::error!(error=?e, "unable to verify sha exists");
                    return Err(e);
                }
            }
        }
        Ok(true)
    }
}
