use std::{sync::Arc, time::Duration};

use crate::{
    disk::DiskGuard,
    process::convert::{self, Converter},
};

/// How long the worker waits before checking a low disk again.
const DISK_RECHECK_INTERVAL: Duration = Duration::from_secs(10);

/// Waits until the disk has room for more jobs.
///
/// A message received on a full disk can only fail, and a message that fails
/// twice is dead-lettered. Left on the queue, it is converted by the task that
/// replaces this one once the health check reports the low disk.
pub(super) async fn wait_for_disk_space(disk: &DiskGuard) {
    let mut paused = false;

    while let Err(e) = disk.check() {
        if !paused {
            tracing::error!(error=?e, "pausing the convert queue: low disk space");
            paused = true;
        }
        tokio::time::sleep(DISK_RECHECK_INTERVAL).await;
    }

    if paused {
        tracing::info!("resuming the convert queue");
    }
}

/// Runs the worker in a loop to handle restarting should it fail.
pub async fn run_worker(
    worker: sqs_worker::SQSWorker,
    s3_client: s3_client::S3,
    lambda_client: lambda_client::Lambda,
    converter: Arc<Converter>,
    disk: DiskGuard,
) {
    loop {
        let worker_result = tokio::spawn({
            let worker = worker.clone();
            let s3_client = s3_client.clone();
            let lambda_client = lambda_client.clone();
            let converter = converter.clone();
            let disk = disk.clone();
            async move {
                tracing::info!("worker started");
                loop {
                    wait_for_disk_space(&disk).await;

                    match worker.receive_messages().await {
                        Ok(messages) => {
                            if messages.is_empty() {
                                continue;
                            }

                            let tasks = messages.clone().into_iter().map(|message| {
                                let worker = worker.clone();
                                let s3_client = s3_client.clone();
                                let lambda_client = lambda_client.clone();
                                let converter = converter.clone();

                                tokio::spawn(async move {
                                    let result = convert::process_message(
                                        &worker,
                                        &s3_client,
                                        &lambda_client,
                                        &converter,
                                        &message,
                                    )
                                    .await;

                                    if let Err(e) = &result {
                                        tracing::error!(message_id=?message.message_id, error=?e, "error processing message");
                                    }
                                    result
                                })
                            });

                            // Collect all tasks into a Vec
                            let handles: Vec<_> = tasks.collect();

                            // Await all tasks to complete
                            let results = futures::future::join_all(handles).await;

                            // Process results if needed
                            for result in results {
                                // Handle JoinError (if the task panicked)
                                if let Err(join_err) = result {
                                    tracing::error!(error=?join_err, "task join error");
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "error receiving messages");
                        }
                    }
                }
            }
        })
        .await;

        match worker_result {
            Ok(_) => {
                // This should never be hit
                tracing::error!("worker exited successfully?");
            }
            Err(e) => {
                tracing::error!(error=?e, "worker crashed with error");
            }
        }

        // Add a delay before restarting to avoid rapid restart loops
        tracing::info!("WORKER RESTARTING...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}
