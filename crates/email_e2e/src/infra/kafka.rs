//! The event topics on the suite's Kafka broker.

use std::time::Duration;

use rdkafka::ClientConfig;
use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::consumer::{BaseConsumer, CommitMode, Consumer};
use rdkafka::types::RDKafkaErrorCode;
use rdkafka::{Offset, TopicPartitionList};
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

/// How long the broker may take to answer about a consumer group.
const GROUP_TIMEOUT: Duration = Duration::from_secs(30);

/// Gives `group` a committed offset, the end of the topic, on every event
/// topic partition where it has none.
///
/// A consumer group without a committed offset starts wherever its
/// `auto.offset.reset` says once the broker has assigned it its partitions,
/// which for a group that starts at the end loses whatever was published
/// while it was joining. With an offset committed before the consumer
/// starts, it reads everything published from now on, however long joining
/// takes.
pub(crate) async fn start_group_at_end(brokers: &str, group: &'static str) -> Result<(), Report> {
    let brokers = brokers.to_owned();
    tokio::task::spawn_blocking(move || commit_missing_offsets(&brokers, group))
        .await
        .context("the Kafka offset task did not finish")?
}

fn commit_missing_offsets(brokers: &str, group: &str) -> Result<(), Report> {
    let consumer: BaseConsumer = ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .set("group.id", group)
        .set("enable.auto.commit", "false")
        .create()
        .context("could not create a Kafka consumer for EMAIL_E2E_KAFKA_BROKERS")?;

    let mut partitions = TopicPartitionList::new();
    for topic in macro_event_topics::all_topic_names() {
        let metadata = consumer
            .fetch_metadata(Some(topic), GROUP_TIMEOUT)
            .context("could not read a Kafka topic's partitions")?;
        for described in metadata.topics() {
            for partition in described.partitions() {
                partitions.add_partition(described.name(), partition.id());
            }
        }
    }
    let committed = consumer
        .committed_offsets(partitions, GROUP_TIMEOUT)
        .context("could not read the consumer group's committed offsets")?;

    let mut missing = TopicPartitionList::new();
    for element in committed.elements() {
        if matches!(element.offset(), Offset::Offset(_)) {
            continue;
        }
        let (_, end) = consumer
            .fetch_watermarks(element.topic(), element.partition(), GROUP_TIMEOUT)
            .context("could not read where a Kafka topic ends")?;
        missing
            .add_partition_offset(element.topic(), element.partition(), Offset::Offset(end))
            .context("could not name a Kafka offset")?;
    }
    if missing.count() == 0 {
        return Ok(());
    }
    // The broker takes offsets from outside a group only while the group
    // has no members: before its first consumer ever starts.
    consumer
        .commit(&missing, CommitMode::Sync)
        .context(format!(
            "could not commit the first offsets of the consumer group {group}: a consumer of \
             it is running, or one was killed moments ago"
        ))?;
    Ok(())
}
