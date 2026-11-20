//! How many unified searches one caller runs at once in this process.
//!
//! OpenSearch gives each node a few search threads, and a heavy search holds
//! one on every shard it reads, so a program that sends ten searches at once
//! fills them and every other caller's search queues behind it inside the
//! cluster. Each caller gets a lane here instead: a few of its searches in
//! flight, the rest waiting their turn in the order they came, and one still
//! waiting at the deadline refused rather than run late.
//!
//! A person in the app, the services searching for them, their API
//! credentials and each agent or routine acting for them are separate callers,
//! so a person's own app searches never wait behind a program's. Lanes live in
//! this process's memory: every replica keeps its own, so what one caller has
//! in flight across the service grows with the replica count, as with
//! `agent_egress`'s connected-app lanes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::Instant;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Lanes kept before idle ones are dropped.
const MAX_LANES: usize = 1024;

/// How many searches one caller may run at once, and how long the rest wait.
#[derive(Clone, Copy, Debug)]
pub struct LanePolicy {
    /// Most searches in flight at once for the person in the app.
    pub app_concurrency: usize,
    /// Most searches in flight at once for every other caller.
    pub concurrency: usize,
    /// Longest a search waits for its turn before it is refused.
    pub max_wait: Duration,
}

impl LanePolicy {
    /// Per process: three searches at once for the person in the app, whose
    /// mention menu sends three one-type searches per term, two for every
    /// other caller, and at most 20 seconds' wait, inside a code execution's
    /// 30-second lifetime.
    pub const DEFAULT: Self = Self {
        app_concurrency: 3,
        concurrency: 2,
        max_wait: Duration::from_secs(20),
    };

    fn concurrency_of(&self, actor: SearchActor) -> usize {
        match actor {
            SearchActor::App => self.app_concurrency,
            SearchActor::Service
            | SearchActor::Api
            | SearchActor::Agent(_)
            | SearchActor::Routine(_) => self.concurrency,
        }
    }
}

/// Who a search runs for: a person, or a program acting with their access.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SearchCaller {
    user: String,
    actor: SearchActor,
}

impl SearchCaller {
    /// The caller searching with `user_id`'s access as `actor`.
    pub fn new(user_id: &str, actor: SearchActor) -> Self {
        Self {
            user: user_id.to_lowercase(),
            actor,
        }
    }

    /// Which kind of lane this caller waits in, as a span value.
    pub fn lane_kind(&self) -> &'static str {
        match self.actor {
            SearchActor::App => "app",
            SearchActor::Service => "service",
            SearchActor::Api => "api",
            SearchActor::Agent(_) => "agent",
            SearchActor::Routine(_) => "routine",
        }
    }
}

/// Who acts with a user's access.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SearchActor {
    /// The person in one of the apps, on their own session.
    App,
    /// Another service searching for them, such as the AI tools of a chat or
    /// an agent's native search tools.
    Service,
    /// An API credential of theirs that no agent or routine signs for: an API
    /// key, the SDK or MCP.
    Api,
    /// An agent acting for them, by its bot id, across all its sessions.
    Agent(Uuid),
    /// A routine's run acting for them with no agent, by its routine id.
    Routine(Uuid),
}

/// A search's turn in its caller's lane, held until the search ends.
#[derive(Debug)]
pub struct LaneTurn {
    _permit: OwnedSemaphorePermit,
    /// How long the search waited for its turn.
    pub waited: Duration,
    /// Whether every slot was taken when it came, so it waited in line.
    pub queued: bool,
}

/// A search refused because its turn had not come by the deadline.
#[derive(Debug)]
pub struct LaneRefusal {
    /// How long it waited before it was refused.
    pub waited: Duration,
}

/// Every caller's lane in this process.
pub struct SearchLanes {
    policy: LanePolicy,
    lanes: Mutex<HashMap<SearchCaller, Arc<Semaphore>>>,
}

impl SearchLanes {
    /// No lanes yet, every lane under `policy`.
    pub fn new(policy: LanePolicy) -> Self {
        Self {
            policy,
            lanes: Mutex::new(HashMap::new()),
        }
    }

    fn lane(&self, caller: SearchCaller) -> Arc<Semaphore> {
        let mut lanes = self.lanes.lock().unwrap_or_else(PoisonError::into_inner);
        // A lane whose only holder is this map has no search running or
        // waiting in it, so dropping it loses nothing.
        if lanes.len() >= MAX_LANES {
            lanes.retain(|_, lane| Arc::strong_count(lane) > 1);
        }
        let concurrency = self.policy.concurrency_of(caller.actor);
        Arc::clone(
            lanes
                .entry(caller)
                .or_insert_with(|| Arc::new(Semaphore::new(concurrency))),
        )
    }

    /// Wait for `caller`'s next turn, or refuse the search once it has waited
    /// the policy's longest wait.
    pub async fn take_turn(&self, caller: SearchCaller) -> Result<LaneTurn, LaneRefusal> {
        let lane = self.lane(caller);
        if let Ok(permit) = Arc::clone(&lane).try_acquire_owned() {
            return Ok(LaneTurn {
                _permit: permit,
                waited: Duration::ZERO,
                queued: false,
            });
        }

        let queued_at = Instant::now();
        match tokio::time::timeout(self.policy.max_wait, lane.acquire_owned()).await {
            Ok(Ok(permit)) => Ok(LaneTurn {
                _permit: permit,
                waited: queued_at.elapsed(),
                queued: true,
            }),
            Ok(Err(_)) | Err(_) => Err(LaneRefusal {
                waited: queued_at.elapsed(),
            }),
        }
    }
}
