//! Requester-only gateway invalidation. Polling remains authoritative; throttling
//! is bounded and process-local, not a durable progress or delivery guarantee.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use connection_gateway_client::ConnectionGatewayClient;
use entity_access::domain::models::EntityType;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;

use crate::domain::{
    models::*,
    ports::{ImportNotifier, PortResult},
};

#[cfg(test)]
mod test;

/// Generic gateway event type consumed as a query invalidation by the browser.
pub const SLACK_IMPORT_UPDATED: &str = "slack_import_updated";
const THROTTLE_INTERVAL: Duration = Duration::from_secs(2);
const RETENTION: Duration = Duration::from_secs(300);
const MAX_TRACKED_JOBS: usize = 4096;

/// Shared clones use one throttle. No source metadata, storage keys, conversation
/// IDs, target IDs or counters are transmitted through this adapter.
#[derive(Clone)]
pub struct GatewayImportNotifier {
    gateway: Arc<ConnectionGatewayClient>,
    throttle: Arc<Mutex<Throttle>>,
}

impl GatewayImportNotifier {
    /// Construct a requester-only notifier with a two-second progress throttle.
    pub fn new(gateway: Arc<ConnectionGatewayClient>) -> Self {
        Self {
            gateway,
            throttle: Arc::new(Mutex::new(Throttle::default())),
        }
    }
}

impl ImportNotifier for GatewayImportNotifier {
    async fn invalidate(
        &self,
        requester: &MacroUserIdStr<'_>,
        team: TeamId,
        job: JobId,
        revision: u64,
        status: JobStatus,
    ) -> PortResult<()> {
        let send = self
            .throttle
            .lock()
            .map_err(|_| ImportError::Internal)?
            .admit(team, job, revision, status, Instant::now());
        if !send {
            return Ok(());
        }
        let entity = EntityType::User.with_entity_str(requester.as_ref());
        self.gateway
            .send_message(
                entity,
                SLACK_IMPORT_UPDATED.to_owned(),
                payload(team, job, revision, status),
            )
            .await
            .map_err(|error| rootcause::report!(error).context(ImportError::Retryable))?;
        Ok(())
    }
}

fn payload(team: TeamId, job: JobId, revision: u64, status: JobStatus) -> Value {
    // Supply an OBJECT to send_message. The gateway serializes it into the
    // websocket envelope's JSON-string data field; pre-encoding double-quotes it.
    serde_json::json!({ "jobId": job, "teamId": team, "revision": revision, "status": status })
}

#[derive(Default)]
struct Throttle {
    sent: HashMap<(TeamId, JobId), Sent>,
}

struct Sent {
    at: Instant,
    revision: u64,
    status: JobStatus,
}

impl Throttle {
    fn admit(
        &mut self,
        team: TeamId,
        job: JobId,
        revision: u64,
        status: JobStatus,
        now: Instant,
    ) -> bool {
        self.sent
            .retain(|_, sent| now.duration_since(sent.at) < RETENTION);
        if let Some(sent) = self.sent.get(&(team, job)) {
            if revision <= sent.revision
                || (status == sent.status && now.duration_since(sent.at) < THROTTLE_INTERVAL)
            {
                return false;
            }
        } else if self.sent.len() >= MAX_TRACKED_JOBS {
            // A saturated process falls back to polling instead of growing an
            // unbounded cache or producing a burst of unthrottled notifications.
            return false;
        }
        // Reserve before I/O, without holding the lock across await. A failed
        // attempt is throttled too; later updates/polling recover lost hints.
        self.sent.insert(
            (team, job),
            Sent {
                at: now,
                revision,
                status,
            },
        );
        true
    }
}
