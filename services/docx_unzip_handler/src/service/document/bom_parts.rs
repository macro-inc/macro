use std::{collections::HashSet, sync::Arc};

use futures::stream::{StreamExt, TryStreamExt};
use lambda_runtime::tracing::{self};

use crate::models::DocumentBomPart;

/// Takes the bom parts that need to be uploaded to s3 and uploads them
#[tracing::instrument(skip(s3_client, document_storage_bucket, bom_parts, bom_parts_to_upload))]
pub async fn upload_bom_parts(
    s3_client: Arc<s3_client::S3>,
    document_storage_bucket: &str,
    bom_parts: Vec<DocumentBomPart>,
    bom_parts_to_upload: Vec<String>,
) -> anyhow::Result<()> {
    let futures = bom_parts.into_iter().map(|bp| {
        let s3_client = s3_client.clone();
        let shared_document_storage_bucket = document_storage_bucket.to_string();
        let shared_bp = bp.clone();
        let shared_bom_parts_to_upload = bom_parts_to_upload.clone();
        tokio::spawn(async move {
            if !shared_bom_parts_to_upload.contains(&bp.sha) {
                return Ok(());
            }
            s3_client
                .put(
                    shared_document_storage_bucket.as_str(),
                    shared_bp.sha.as_str(),
                    &shared_bp.content,
                )
                .await
        })
    });

    let results = futures::future::join_all(futures).await;
    for result in results {
        match result {
            Ok(Ok(())) => (),
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

/// How many `HeadObject` requests one docx keeps in flight.
const CONCURRENT_PART_CHECKS: usize = 16;

/// The distinct SHAs in `shas` with no object in the document storage bucket.
/// S3 is the only record of what is stored.
#[tracing::instrument(
    name = "docx.unzip_part_check",
    skip_all,
    fields(part_count = shas.len(), missing_count = tracing::field::Empty),
    err
)]
pub async fn missing_shas(
    s3_client: &s3_client::S3,
    document_storage_bucket: &str,
    shas: &[String],
) -> anyhow::Result<Vec<String>> {
    let distinct_shas: HashSet<String> = shas.iter().cloned().collect();
    let missing_shas: Vec<String> = futures::stream::iter(distinct_shas)
        .map(|sha| async move {
            let stored = s3_client.exists(document_storage_bucket, &sha).await?;
            anyhow::Ok((!stored).then_some(sha))
        })
        .buffer_unordered(CONCURRENT_PART_CHECKS)
        .try_filter_map(|missing| async move { Ok(missing) })
        .try_collect()
        .await?;
    tracing::Span::current().record("missing_count", missing_shas.len());
    Ok(missing_shas)
}
