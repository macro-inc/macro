//! The event topics on the suite's Kafka broker.

use std::time::Duration;

use rdkafka::ClientConfig;
use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::consumer::{BaseConsumer, CommitMode, Consumer};
use rdkafka::types::RDKafkaErrorCode;
use rdkafka::{Message, Offset, TopicPartitionList};
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

/// How long reading a topic's recent events may take.
const READ_TIMEOUT: Duration = Duration::from_secs(20);
/// How long one wait for the next event is.
const POLL: Duration = Duration::from_millis(250);
/// The group the evidence reader names. It never subscribes or commits, so
/// every scenario can use it at once.
const EVIDENCE_GROUP: &str = "email-e2e-evidence";

/// Where each partition of `topic` ends right now: (partition, offset).
pub(crate) async fn topic_ends(
    brokers: &str,
    topic: &'static str,
) -> Result<Vec<(i32, i64)>, Report> {
    let brokers = brokers.to_owned();
    tokio::task::spawn_blocking(move || {
        let consumer = reader(&brokers)?;
        Ok(watermarks(&consumer, topic)?
            .into_iter()
            .map(|(partition, _, end)| (partition, end))
            .collect())
    })
    .await
    .context("the Kafka offset task did not finish")?
}

/// The payload of every event published to `topic` since `starts`, which
/// [`topic_ends`] answered earlier, up to where the topic ends now. A
/// partition `starts` does not name is read from its beginning.
pub(crate) async fn published_since(
    brokers: &str,
    topic: &'static str,
    starts: Vec<(i32, i64)>,
) -> Result<Vec<Vec<u8>>, Report> {
    let brokers = brokers.to_owned();
    tokio::task::spawn_blocking(move || read_since(&brokers, topic, &starts))
        .await
        .context("the Kafka read task did not finish")?
}

fn reader(brokers: &str) -> Result<BaseConsumer, Report> {
    Ok(ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .set("group.id", EVIDENCE_GROUP)
        .set("enable.auto.commit", "false")
        .create()
        .context("could not create a Kafka consumer for EMAIL_E2E_KAFKA_BROKERS")?)
}

/// Each partition of `topic` with where it starts and ends.
fn watermarks(consumer: &BaseConsumer, topic: &str) -> Result<Vec<(i32, i64, i64)>, Report> {
    let metadata = consumer
        .fetch_metadata(Some(topic), GROUP_TIMEOUT)
        .context("could not read a Kafka topic's partitions")?;
    let mut partitions = Vec::new();
    for described in metadata.topics() {
        for partition in described.partitions() {
            let (start, end) = consumer
                .fetch_watermarks(topic, partition.id(), GROUP_TIMEOUT)
                .context("could not read where a Kafka topic ends")?;
            partitions.push((partition.id(), start, end));
        }
    }
    Ok(partitions)
}

fn read_since(brokers: &str, topic: &str, starts: &[(i32, i64)]) -> Result<Vec<Vec<u8>>, Report> {
    let consumer = reader(brokers)?;
    let mut assignment = TopicPartitionList::new();
    // Partition to the offset its reading stops before.
    let mut ends = std::collections::BTreeMap::new();
    for (partition, first, end) in watermarks(&consumer, topic)? {
        let start = starts
            .iter()
            .find(|(known, _)| *known == partition)
            .map_or(first, |(_, offset)| (*offset).max(first));
        if start < end {
            assignment
                .add_partition_offset(topic, partition, Offset::Offset(start))
                .context("could not name a Kafka offset")?;
            ends.insert(partition, end);
        }
    }
    if ends.is_empty() {
        return Ok(Vec::new());
    }
    consumer
        .assign(&assignment)
        .context("could not read the Kafka topic")?;

    let mut payloads = Vec::new();
    let deadline = std::time::Instant::now() + READ_TIMEOUT;
    while !ends.is_empty() {
        if std::time::Instant::now() > deadline {
            bail!("the events of {topic} could not be read within {READ_TIMEOUT:?}");
        }
        let Some(message) = consumer.poll(POLL) else {
            continue;
        };
        let message = message.context("could not read an event")?;
        let Some(end) = ends.get(&message.partition()).copied() else {
            continue;
        };
        if message.offset() < end
            && let Some(payload) = message.payload()
        {
            payloads.push(payload.to_vec());
        }
        if message.offset() + 1 >= end {
            ends.remove(&message.partition());
        }
    }
    Ok(payloads)
}
