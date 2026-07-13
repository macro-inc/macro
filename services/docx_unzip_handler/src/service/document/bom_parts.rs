use std::sync::Arc;

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
