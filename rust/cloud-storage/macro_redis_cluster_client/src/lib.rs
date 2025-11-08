mod decrement_count;
mod exists;
mod increment_count;

use model::document::SaveBomPart;

#[derive(Clone)]
pub struct Redis {
    inner: redis::cluster::ClusterClient,
}

// Key prefixes
static SHA_COUNT_KEY_PREFIX: &str = "sha:";
static SHA_DELETE_BUCKET: &str = "bucket:sha-delete";

impl Redis {
    pub fn new(inner: redis::cluster::ClusterClient) -> Self {
        Self { inner }
    }

    pub async fn increment_counts(&self, shas: Vec<String>) -> anyhow::Result<()> {
        increment_count::increment_counts(&self.inner, shas).await
    }

    pub async fn decrement_counts(&self, shas: &Vec<(String, i64)>) -> anyhow::Result<()> {
        decrement_count::decrement_counts(&self.inner, SHA_DELETE_BUCKET, shas).await
    }

    pub async fn find_non_existing_shas(
        &self,
        bom_parts: &Vec<SaveBomPart>,
    ) -> anyhow::Result<Vec<SaveBomPart>> {
        exists::find_non_existing_shas(&self.inner, bom_parts).await
    }

    pub async fn find_non_existing_shas_string(
        &self,
        shas: Vec<String>,
    ) -> anyhow::Result<Vec<String>> {
        exists::find_non_existing_shas_string(&self.inner, shas).await
    }

    pub async fn sha_exists(&self, sha: &str) -> anyhow::Result<bool> {
        exists::exists(
            &self.inner,
            format!("{}{}", SHA_COUNT_KEY_PREFIX, sha).as_str(),
        )
        .await
    }
}
