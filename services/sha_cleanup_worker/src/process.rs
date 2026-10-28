use crate::service;
use futures::StreamExt;
use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
enum ProcessOp {
    Noop,
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

    let shared_db_client = &db_client;
    let shared_s3_client = &s3_client;
    let delete_sha_results: Vec<
        Result<(service::db::QueuedSha, ProcessOp), (String, anyhow::Error)>,
    > = futures::stream::iter(queued.into_iter())
        .then(|queued| async move {
            let sha = queued.sha.as_str();
            tracing::trace!("attempting to delete sha {sha}");
            let count = shared_db_client
                .get_sha_count(sha)
                .await
                .map_err(|e| (sha.to_string(), e))?;

            if count != 0 {
                return Ok((queued, ProcessOp::Noop));
            }

            shared_s3_client
                .delete_sha(sha)
                .await
                .map_err(|e| (sha.to_string(), e))?;

            Ok((queued, ProcessOp::Deleted))
        })
        .collect()
        .await;

    let mut done = Vec::new();
    for result in delete_sha_results {
        match result {
            Ok((queued, ProcessOp::Noop)) => {
                tracing::trace!("sha {} was noop", queued.sha);
                done.push(queued);
            }
            Ok((queued, ProcessOp::Deleted)) => {
                tracing::trace!("sha {} was deleted", queued.sha);
                done.push(queued);
            }
            Err((sha, e)) => {
                tracing::error!(error=?e, "unable to delete sha {sha}");
            }
        }
    }

    db_client.dequeue_shas(done).await?;

    Ok(())
}
