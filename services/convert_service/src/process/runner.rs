use crate::process::convert;

/// Runs the worker in a loop to handle restarting should it fail.
pub async fn run_worker(
    worker: sqs_worker::SQSWorker,
    s3_client: s3_client::S3,
    lambda_client: lambda_client::Lambda,
) {
    loop {
        let worker_result = tokio::spawn({
            let worker = worker.clone();
            let s3_client = s3_client.clone();
            let lambda_client = lambda_client.clone();
            async move {
                tracing::info!("worker started");
                loop {
                    match worker.receive_messages().await {
                        Ok(messages) => {
                            if messages.is_empty() {
                                continue;
                            }

                            let tasks = messages.clone().into_iter().map(|message| {
                                let worker = worker.clone();
                                let s3_client = s3_client.clone();
                                let lambda_client = lambda_client.clone();

                                tokio::spawn(async move {
                                    let result = convert::process_message(
                                        &worker,
                                        &s3_client,
                                        &lambda_client,
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
