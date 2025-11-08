use aws_sdk_s3::presigning::PresignedRequest;

mod copy;
mod delete;
mod exists;
mod get;
mod get_folder;
mod put;

#[derive(Clone, Debug)]
pub struct S3 {
    inner: aws_sdk_s3::Client,
}

impl S3 {
    pub fn new(inner: aws_sdk_s3::Client) -> Self {
        Self { inner }
    }

    /// Retreives the provided key from the bucket.
    #[tracing::instrument(skip(self))]
    pub async fn get(&self, bucket: &str, key: &str) -> anyhow::Result<Vec<u8>> {
        get::get(&self.inner, bucket, key).await
    }

    /// Gets a presigned url for the provided key.
    #[tracing::instrument(skip(self))]
    pub async fn get_presigned_url(
        &self,
        bucket: &str,
        key: &str,
        duration_seconds: u64,
    ) -> anyhow::Result<PresignedRequest> {
        get::get_presigned_url(&self.inner, bucket, key, duration_seconds).await
    }

    /// Puts the provided content into the bucket at the provided key.
    #[tracing::instrument(skip(self))]
    pub async fn put(&self, bucket: &str, key: &str, content: &[u8]) -> anyhow::Result<()> {
        put::put(&self.inner, bucket, key, content).await
    }

    /// Checks if a given key exists in the bucket.
    #[tracing::instrument(skip(self))]
    pub async fn exists(&self, bucket: &str, key: &str) -> anyhow::Result<bool> {
        exists::exists(&self.inner, bucket, key).await
    }

    /// Deletes the provided key from the bucket.
    #[tracing::instrument(skip(self))]
    pub async fn delete(&self, bucket: &str, key: &str) -> anyhow::Result<()> {
        delete::delete(&self.inner, bucket, key).await
    }

    /// Deletes all items under a given folder
    #[tracing::instrument(skip(self))]
    pub async fn delete_folder(&self, bucket: &str, folder: &str) -> anyhow::Result<()> {
        delete::delete_folder(&self.inner, bucket, folder).await
    }

    /// Gets all the keys in a folder
    /// Returns a list of the (file_name, file_type) for each file in the folder
    #[tracing::instrument(skip(self))]
    pub async fn get_folder_content_names(
        &self,
        bucket: &str,
        folder_path: &str,
    ) -> anyhow::Result<Vec<(String, String)>> {
        get_folder::get_folder_content_names(&self.inner, bucket, folder_path).await
    }

    /// Copies an object from one bucket to another place in the same bucket
    pub async fn inner_bucket_copy(
        &self,
        bucket: &str,
        source_key: &str,
        destination_key: &str,
    ) -> anyhow::Result<()> {
        copy::inner_bucket_copy(&self.inner, bucket, source_key, destination_key).await
    }
}
