//! The event topics on the suite's Kafka broker.

use std::time::Duration;

use rdkafka::ClientConfig;
use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::types::RDKafkaErrorCode;
use rootcause::prelude::*;

/// How long the broker may take to create the topics.
const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

/// Creates every declared event topic that the broker does not have yet.
///
/// `document_storage_service` does not start without the topics it reads,
/// and a consumer does not create one by subscribing. The topics are the
/// broker's, shared by every scenario.
pub(crate) async fn ensure_topics(brokers: &str) -> Result<(), Report> {
    let admin: AdminClient<DefaultClientContext> = ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .create()
        .context("could not create a Kafka admin client for EMAIL_E2E_KAFKA_BROKERS")?;

    let topics: Vec<NewTopic<'_>> = macro_event_topics::all_topic_names()
        .iter()
        .map(|name| NewTopic::new(name, 1, TopicReplication::Fixed(1)))
        .collect();
    let options = AdminOptions::new().operation_timeout(Some(OPERATION_TIMEOUT));
    let created = admin
        .create_topics(topics.iter(), &options)
        .await
        .context("could not create the Kafka topics at EMAIL_E2E_KAFKA_BROKERS")?;
    for result in created {
        match result {
            // Another scenario, or an earlier run, made it.
            Ok(_) | Err((_, RDKafkaErrorCode::TopicAlreadyExists)) => {}
            Err((topic, error)) => bail!("could not create the Kafka topic {topic}: {error}"),
        }
    }
    Ok(())
}
