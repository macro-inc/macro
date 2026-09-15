//! Collecting a self-hosted harness's changes over the Redis runtime bus.
//!
//! A `macrod` daemon's socket lives on exactly one replica, and the replica
//! serving the Changes pane's request is not necessarily it. The same bus
//! that carries commands and model probes carries this: every replica hears
//! the request, the one holding the socket asks its daemon, and the answer is
//! broadcast back for whoever is waiting. Mirrors
//! [`crate::model_providers::MacrodModels`], correlated by request id because
//! two diffs of two harnesses can overlap.

use std::sync::Arc;
use std::time::Duration;

use agent_harness::domain::ports::{CollectChangesError, HarnessChanges};
use agent_harness::inbound::runtime_gateway::GatewaySender;
use agent_harness::outbound::forward::COMMAND_CHANNEL;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_runtime_protocol::domain::schema::v0::CollectChangesResult;
use harness_id::HarnessId;
use macro_uuid::Uuid;
use redis::AsyncCommands as _;
use tokio::sync::broadcast;

#[cfg(test)]
mod test;

/// Changes events broadcast alongside runtime commands and model probes.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ChangesBusEvent {
    /// Whichever replica holds this harness's socket should ask its daemon.
    CollectChanges {
        /// Echoed on the answer so the asker can pick it out.
        request_id: Uuid,
        harness: HarnessId,
    },
    /// The daemon's answer, for whichever replica asked.
    ChangesCollected {
        request_id: Uuid,
        result: CollectChangesResult,
    },
}

/// [`HarnessChanges`] over the shared runtime bus, on every replica.
#[derive(Clone)]
pub struct MacrodChangesBus {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    redis: redis::Client,
    answers: broadcast::Sender<(Uuid, CollectChangesResult)>,
    timeout: Duration,
}

impl MacrodChangesBus {
    /// Build the bus publisher and local observer shared with its consumer.
    pub fn new(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        redis: redis::Client,
        timeout: Duration,
    ) -> Self {
        Self {
            runtimes,
            redis,
            answers: broadcast::channel(64).0,
            timeout,
        }
    }

    /// Handle one bus event, independently of whoever is waiting locally.
    pub(crate) async fn observe(&self, event: ChangesBusEvent) -> Result<(), CollectChangesError> {
        match event {
            ChangesBusEvent::ChangesCollected { request_id, result } => {
                // Nobody waiting is normal: every replica hears every answer.
                let _ = self.answers.send((request_id, result));
                Ok(())
            }
            ChangesBusEvent::CollectChanges {
                request_id,
                harness,
            } => {
                let result = match tokio::time::timeout(
                    self.timeout,
                    self.runtimes.collect_changes(harness),
                )
                .await
                {
                    // Only the socket-owning replica answers.
                    Ok(None) => return Ok(()),
                    Ok(Some(Ok(result))) => result,
                    Ok(Some(Err(error))) => CollectChangesResult::Error {
                        message: error.to_string(),
                    },
                    Err(_) => CollectChangesResult::Error {
                        message: "The harness took too long to collect its changes.".to_owned(),
                    },
                };
                self.publish(ChangesBusEvent::ChangesCollected { request_id, result })
                    .await
            }
        }
    }

    async fn publish(&self, event: ChangesBusEvent) -> Result<(), CollectChangesError> {
        let payload = serde_json::to_string(&event)
            .map_err(|error| CollectChangesError::Failed(error.to_string()))?;
        let mut connection = self
            .redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| CollectChangesError::Failed(error.to_string()))?;
        connection
            .publish::<_, _, ()>(COMMAND_CHANNEL, payload)
            .await
            .map_err(|error| CollectChangesError::Failed(error.to_string()))
    }
}

impl HarnessChanges for MacrodChangesBus {
    #[tracing::instrument(skip(self), err, fields(%harness))]
    async fn collect_changes(
        &self,
        harness: HarnessId,
    ) -> Result<CollectChangesResult, CollectChangesError> {
        // The socket may be right here, in which case the bus round trip
        // is a detour - but the answer is the same and the path is one.
        // Subscribe before publishing so an immediate answer is not missed.
        let mut answers = self.answers.subscribe();
        let request_id = macro_uuid::generate_uuid_v7();
        self.publish(ChangesBusEvent::CollectChanges {
            request_id,
            harness,
        })
        .await?;
        // A little past the socket owner's own deadline, so its timeout
        // answer arrives before this one fires and the reason is theirs.
        let deadline = self.timeout + Duration::from_secs(5);
        let wait = async {
            loop {
                match answers.recv().await {
                    Ok((answered, result)) if answered == request_id => return Ok(result),
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        return Err(CollectChangesError::Failed(
                            "the changes bus observer is gone".to_owned(),
                        ));
                    }
                }
            }
        };
        match tokio::time::timeout(deadline, wait).await {
            Ok(answer) => answer,
            // No replica claimed the socket and answered: the daemon is not
            // connected anywhere.
            Err(_) => Err(CollectChangesError::NotConnected),
        }
    }
}
