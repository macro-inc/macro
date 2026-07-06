//! Idempotent local Kafka topic creation, mirroring [`super::localstack`].
//!
//! The topics come from `macro_event_topics::all_topic_names()` — the same
//! source of truth the MSK stack consumes (via the generated
//! `.github/kafka-cluster-topics.json`) — so a topic declared in the crate
//! exists both locally and in the deployed cluster without a second list.
//!
//! Gated behind the `local-stack` feature: rdkafka links a system librdkafka,
//! which the bare CI runners that build xtask don't have. The just recipes
//! enable the feature; without it the provisioning entry points fail with
//! instructions instead of the whole binary failing to build.

#[cfg(feature = "local-stack")]
use std::time::Duration;

#[cfg(feature = "local-stack")]
use anyhow::Context;
use anyhow::Result;
#[cfg(feature = "local-stack")]
use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
#[cfg(feature = "local-stack")]
use rdkafka::client::DefaultClientContext;
#[cfg(feature = "local-stack")]
use rdkafka::types::RDKafkaErrorCode;
#[cfg(feature = "local-stack")]
use rdkafka::ClientConfig;

use super::instance::Instance;
#[cfg(feature = "local-stack")]
use super::instance::Port;

/// Partitions per local topic. Prod defaults to 6
/// (`infra/stacks/kafka-cluster/topics.ts`); local mirrors the partition count
/// but drops replication to 1 for the single-broker cluster.
#[cfg(feature = "local-stack")]
const PARTITIONS: i32 = 6;

/// How long the broker may take to finish creating the topics before the
/// request errors — generous because the broker was healthy moments ago.
#[cfg(feature = "local-stack")]
const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

/// Fail fast (before any containers start) when this build can't provision
/// Kafka topics. No-op when the `local-stack` feature is enabled.
#[cfg(feature = "local-stack")]
pub fn ensure_available(_command: &str) -> Result<()> {
    Ok(())
}

/// Fail fast (before any containers start) when this build can't provision
/// Kafka topics. No-op when the `local-stack` feature is enabled.
#[cfg(not(feature = "local-stack"))]
pub fn ensure_available(command: &str) -> Result<()> {
    anyhow::bail!(
        "`{command}` provisions Kafka topics, but this xtask build lacks the \
         `local-stack` feature (rdkafka). Use the just recipe (e.g. `just \
         run_local`) or `cargo run -p xtask --features local-stack -- {command}`."
    )
}

/// Create every declared event topic on the instance's local broker.
/// Blocking entry point: spins up a Tokio runtime so the orchestrator stays
/// synchronous (same shape as `localstack::provision`).
#[cfg(feature = "local-stack")]
pub fn provision(instance: &Instance) -> Result<()> {
    let brokers = format!("localhost:{}", instance.port(Port::Kafka));
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?;
    rt.block_on(provision_async(&brokers))
}

/// Feature-off stub: unreachable in practice because [`ensure_available`]
/// rejects the provisioning commands at dispatch, but it keeps the call sites
/// compiling and fails loudly if a new path forgets the dispatch guard.
#[cfg(not(feature = "local-stack"))]
pub fn provision(_instance: &Instance) -> Result<()> {
    ensure_available("kafka-provision")
}

#[cfg(feature = "local-stack")]
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
