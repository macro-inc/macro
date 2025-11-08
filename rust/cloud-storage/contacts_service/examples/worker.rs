use anyhow::Context;
use contacts_service::queue::MessageQueue;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    MacroEntrypoint::default().init();
    let notification_queue: &'static str = "http://localhost:4566/000000000000/my-test-queue";
    let notification_queue_max_messages = 10;
    let notification_queue_wait_time_seconds = 3;
    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .endpoint_url(notification_queue)
        .load()
        .await;
    let sqs_client = aws_sdk_sqs::Client::new(&aws_config);
    let sqs = sqs_worker::SQSWorker::new(
        sqs_client,
        notification_queue.to_string(),
        notification_queue_max_messages,
        notification_queue_wait_time_seconds,
    );

    let database_url = "postgres://user:password@localhost:5432/contacts";

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(database_url)
        .await
        .context("could not connect to db")?;

    let mut worker = MessageQueue::new(sqs, db);
    worker.poll().await;
    Ok(())
}
