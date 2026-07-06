//! Idempotent local Kafka topic creation, mirroring [`super::localstack`].
//!
//! The topics come from `macro_event_topics::all_topic_names()` — the same
//! source of truth the MSK stack consumes (via the generated
//! `.github/kafka-cluster-topics.json`) — so a topic declared in the crate
//! exists both locally and in the deployed cluster without a second list.

use std::time::Duration;

use anyhow::{Context, Result};
use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::types::RDKafkaErrorCode;
use rdkafka::ClientConfig;

use super::instance::{Instance, Port};

/// Partitions per local topic. Prod defaults to 6
/// (`infra/stacks/kafka-cluster/topics.ts`); local mirrors the partition count
/// but drops replication to 1 for the single-broker cluster.
const PARTITIONS: i32 = 6;

/// How long the broker may take to finish creating the topics before the
/// request errors — generous because the broker was healthy moments ago.
const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

/// Create every declared event topic on the instance's local broker.
/// Blocking entry point: spins up a Tokio runtime so the orchestrator stays
/// synchronous (same shape as `localstack::provision`).
pub fn provision(instance: &Instance) -> Result<()> {
    let brokers = format!("localhost:{}", instance.port(Port::Kafka));
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?;
    rt.block_on(provision_async(&brokers))
}

async fn provision_async(brokers: &str) -> Result<()> {
    let admin: AdminClient<DefaultClientContext> = ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .create()
        .context("creating kafka admin client")?;

    let names = macro_event_topics::all_topic_names();
    let topics: Vec<NewTopic> = names
        .iter()
        .map(|name| NewTopic::new(name, PARTITIONS, TopicReplication::Fixed(1)))
        .collect();

    let opts = AdminOptions::new().operation_timeout(Some(OPERATION_TIMEOUT));
    let results = admin
        .create_topics(topics.iter(), &opts)
        .await
        .context("creating kafka topics")?;
    for result in results {
        match result {
            Ok(_) => {}
            // Re-runs against a persisted volume find the topics already there.
            Err((_, RDKafkaErrorCode::TopicAlreadyExists)) => {}
            Err((topic, err)) => anyhow::bail!("creating topic '{topic}' failed: {err}"),
        }
    }
    Ok(())
}
