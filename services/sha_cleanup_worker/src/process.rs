use crate::service;
use futures::StreamExt;
use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
enum ProcessOp {
    Noop,
    Deleted,
}

#[tracing::instrument(skip(db_client, s3_client, redis_client))]
pub async fn process(
    db_client: Arc<service::db::DB>,
    s3_client: Arc<service::s3::S3>,
    redis_client: Arc<service::redis::Redis>,
) -> Result<(), anyhow::Error> {
    // Grab shas from set
    let shas = redis_client.get_shas_from_delete_bucket().await?;

    // Early exit if there are no shas to delete
    if shas.is_empty() {
        tracing::info!("delete bucket empty");
        return Ok(());
    }

    tracing::info!("potentially deleting {} shas", shas.len());

    let shared_db_client = &db_client;
    let shared_s3_client = &s3_client;
    let shared_redis_client = &redis_client;
    let delete_sha_results: Vec<Result<(String, ProcessOp), (String, anyhow::Error)>> =
        futures::stream::iter(shas.iter())
            .then(|sha| async move {
                tracing::trace!("attempting to delete sha {sha}");
                let count = shared_db_client
                    .get_sha_count(sha.as_str())
                    .await
                    .map_err(|e| (sha.clone(), e))?;

                if count != 0 {
                    // update sha count in redis
                    shared_redis_client
                        .set_sha_count(sha.as_str(), count)
                        .await
                        .map_err(|e| (sha.clone(), e))?;
                    return Ok((sha.clone(), ProcessOp::Noop));
                }

                // Delete sha from S3
                shared_s3_client
                    .delete_sha(sha.as_str())
                    .await
                    .map_err(|e| (sha.clone(), e))?;

                Ok((sha.clone(), ProcessOp::Deleted))
            })
            .collect::<Vec<Result<(String, ProcessOp), (String, anyhow::Error)>>>()
            .await;

    for result in delete_sha_results.iter() {
        match result {
            Ok((sha, ProcessOp::Noop)) => {
                tracing::trace!("sha {sha} was noop");
            }
            Ok((sha, ProcessOp::Deleted)) => {
                tracing::trace!("sha {sha} was deleted");
            }
            Err((sha, e)) => {
                tracing::error!(error=?e, "unable to delete sha {sha}");
            }
        }
    }

    let filterd_shas: Vec<String> = delete_sha_results
        .into_iter()
        .filter_map(|r| r.ok())
        .map(|(s, _)| s)
        .collect();

    // Shas are cleaned up, remove them all from the delete bucket set
    redis_client
        .remove_shas_from_set(filterd_shas.clone())
        .await?;

    Ok(())
}
