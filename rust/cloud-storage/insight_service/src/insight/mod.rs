pub mod batch_processor;
pub mod consumer;
pub mod context_consumer_registry;
pub mod context_router;
pub mod deduplication;
pub mod insight_context_handler;
pub mod queue;
pub mod smart_ranking;

use crate::config::{Config, Environment};
use crate::context::ServiceContext;
use aws_sdk_sqs::Client;
use queue::ContextQueue;
use sqs_worker::SQSWorker;

pub async fn setup_and_poll(config: Config) {
    let context_router = context_router::ContextRouter::default();
    let sqs_worker = make_sqs_worker(&config).await;
    let context_config = ServiceContext::try_from_config(&config)
        .await
        .expect("context config failed to initialize");
    let queue = ContextQueue::new(sqs_worker, context_config, context_router);
    queue.poll().await;
}

async fn make_sqs_worker(config: &Config) -> SQSWorker {
    let conf = match config.environment {
        Environment::Local => {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .endpoint_url(&config.queue_url)
                .load()
                .await
        }
        _ => {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await
        }
    };

    let client = Client::new(&conf);
    sqs_worker::SQSWorker::new(
        client,
        config.queue_url.clone(),
        config.queue_max_messages as i32,
        config.queue_wait_time_seconds as i32,
    )
}
