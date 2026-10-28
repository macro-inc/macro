use crate::service;
use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
enum Outcome {
    /// Released again since the queue was read; the next run handles it.
    Requeued,
    /// Still referenced by a `"BomPart"` row, so the object stays.
    Referenced,
    Deleted,
}

#[tracing::instrument(skip(db_client, s3_client))]
pub async fn process(
    db_client: Arc<service::db::DB>,
    s3_client: Arc<service::s3::S3>,
) -> Result<(), anyhow::Error> {
    let queued = db_client.queued_shas().await?;

    if queued.is_empty() {
        tracing::info!("sha cleanup queue empty");
        return Ok(());
    }

    tracing::info!("potentially deleting {} shas", queued.len());

    for queued in queued {
        if let Err(e) = clean_up_sha(&db_client, &s3_client, &queued).await {
            tracing::error!(error=?e, sha=%queued.sha, "unable to clean up sha");
        }
    }

    Ok(())
}

/// Deletes the object for `queued` unless a `"BomPart"` row references it.
/// The reference check and dequeue are one statement, and the dequeue commits
/// only after the S3 delete succeeds.
#[tracing::instrument(
    name = "sha_cleanup.clean_up_sha",
    skip_all,
    fields(sha = %queued.sha, outcome = tracing::field::Empty),
    err
)]
async fn clean_up_sha(
    db_client: &service::db::DB,
    s3_client: &service::s3::S3,
    queued: &service::db::QueuedSha,
) -> anyhow::Result<()> {
    let outcome = match db_client.claim_sha(queued).await? {
        None => Outcome::Requeued,
        Some(claim) if claim.referenced => {
            claim.commit().await?;
            Outcome::Referenced
        }
        Some(claim) => {
            s3_client.delete_sha(&queued.sha).await?;
            claim.commit().await?;
            Outcome::Deleted
        }
    };
    tracing::Span::current().record("outcome", tracing::field::debug(outcome));
    Ok(())
}
