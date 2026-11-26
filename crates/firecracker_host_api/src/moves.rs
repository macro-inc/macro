//! Moving a computer to another host: its dataset is copied with
//! `zfs send`/`zfs receive`, first while it runs (pre-copy, repeatable,
//! each round sending what changed since the last), then once more after a
//! clean shutdown (the final round), and the new host adopts it.
//!
//! Two legs:
//!
//! - control plane → agents, over the agents' mTLS API: [`ExpectMove`]
//!   (`PUT /v1/moves/{id}`) on the target, then [`Replicate`]
//!   (`POST /v1/computers/{id}/replication`) on the source, polled with `GET`
//!   until [`ReplicationState::Done`], `POST /v1/computers/{id}/release` on
//!   the source before the final round, [`AdoptComputer`]
//!   (`POST /v1/moves/{id}/adopt`) on the target, and
//!   `DELETE /v1/moves/{id}` to drop a staged copy.
//! - source agent → target agent, over the WireGuard mesh between hosts on
//!   the target's move listener: one TCP connection per request, a
//!   [`PeerRequest`] JSON line, then (for [`PeerOperation::Receive`] and
//!   [`PeerOperation::ReceiveBase`]) the raw `zfs send` stream until the
//!   source closes its write side; the target answers one [`PeerAnswer`]
//!   JSON line. The ticket from [`ExpectMove`] authenticates the
//!   source; WireGuard encrypts the link.
//!
//! A host keeps a computer in one of two places: live (served, in its
//! computers) or staged (received, or released before the final round: not
//! served, never started, only replicated, adopted or dropped). A computer
//! is never live on two hosts.
//!
//! Only the disks and the record move. Memory snapshots are not portable
//! across CPU models or host kernels, so a released computer is shut down
//! (or its hibernation discarded) and cold boots on its new host.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{ComputerId, ControlPlaneId, EnrollmentGeneration};

/// The secret a source host presents to the target for one move. Never
/// printed (`Debug` is redacted), compared in constant time, and wiped
/// from memory when dropped.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema), schema(value_type = String))]
#[serde(transparent)]
pub struct MoveTicket(String);

impl MoveTicket {
    /// Wrap a ticket.
    pub fn new(ticket: String) -> Self {
        Self(ticket)
    }

    /// The ticket's text, to send it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl PartialEq for MoveTicket {
    fn eq(&self, other: &Self) -> bool {
        use subtle::ConstantTimeEq as _;
        self.0.as_bytes().ct_eq(other.0.as_bytes()).into()
    }
}

impl Eq for MoveTicket {}

impl std::fmt::Debug for MoveTicket {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MoveTicket(**redacted**)")
    }
}

impl Drop for MoveTicket {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.0);
    }
}

/// `PUT` on the target: accept a computer from a source host with this
/// ticket until it expires. Replaces an earlier expectation for the
/// computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ExpectMove {
    /// The secret the source presents; random, at least 32 bytes of entropy.
    pub ticket: MoveTicket,
    /// When the target stops accepting it.
    pub expires_at: DateTime<Utc>,
}

/// `POST` on the source: start (or join) a replication round of the
/// computer to the target. Answers its [`Replication`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Replicate {
    /// The target's move listener, e.g. `10.88.0.2:8446` (its
    /// WireGuard address).
    pub target: String,
    /// The ticket the target expects ([`ExpectMove`]).
    pub ticket: MoveTicket,
}

/// Where a computer's replication stands on its source host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Replication {
    /// The round.
    pub state: ReplicationState,
    /// Whether the computer was released before this round, so the round
    /// carries everything it will ever write here (the final round).
    pub released: bool,
    /// The snapshot the round sends.
    pub snapshot: Option<String>,
    /// The snapshot it sends changes since; `None` for a first round, which
    /// sends from the computer's golden.
    pub incremental_from: Option<String>,
    /// Bytes sent so far.
    pub bytes: u64,
    /// When the round started.
    pub started_at: Option<DateTime<Utc>>,
    /// When it ended.
    pub finished_at: Option<DateTime<Utc>>,
}

/// A replication round's state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ReplicationState {
    /// No round since the agent started.
    Idle,
    /// Sending.
    Running,
    /// The target has everything up to [`Replication::snapshot`].
    Done,
    /// The round failed; `POST` again to retry (a broken stream resumes).
    Failed {
        /// Why, for logs.
        message: String,
    },
}

/// `POST` on the target: serve the staged computer received from its
/// source. Answers the [`crate::Computer`], stopped: its first start cold
/// boots its own rootfs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AdoptComputer {
    /// The control plane that owns it; the received record must match.
    pub control_plane_id: ControlPlaneId,
    /// Its enrollment generation; the received record must match.
    pub generation: EnrollmentGeneration,
}

/// What a host holds of a moving computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MoveHolding {
    /// The computer.
    pub computer_id: ComputerId,
    /// Whether it is live here (served).
    pub live: bool,
    /// Whether a staged copy is here.
    pub staged: bool,
    /// The staged copy's snapshots, oldest first.
    pub snapshots: Vec<String>,
}

/// One request on the move listener.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PeerRequest {
    /// The computer.
    pub computer_id: ComputerId,
    /// From [`ExpectMove`].
    pub ticket: MoveTicket,
    /// What to do.
    pub operation: PeerOperation,
    /// The source's W3C `traceparent`, so the target's work joins the
    /// move's trace (the hop is not HTTP, so no header carries it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_context: Option<String>,
}

/// What the source asks the target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PeerOperation {
    /// Answer [`PeerAnswer::State`].
    State,
    /// The rest of the connection is a `zfs send` stream of the computer.
    Receive {
        /// For a first round: the guid of the golden snapshot the stream is
        /// incremental from, which the target holds as a base.
        origin_guid: Option<u64>,
    },
    /// The rest of the connection is a full `zfs send` of the golden
    /// snapshot with this guid, kept as a base for computers cloned from it.
    ReceiveBase {
        /// The snapshot's guid.
        guid: u64,
    },
}

/// The target's answer line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(
    tag = "answer",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PeerAnswer {
    /// What the target holds.
    State {
        /// The staged copy's snapshots, oldest first; empty when none.
        snapshots: Vec<PeerSnapshot>,
        /// A partially received stream's resume token.
        resume_token: Option<String>,
        /// Guids of the golden snapshots held as bases.
        bases: Vec<u64>,
        /// Whether the computer is live on the target, which refuses
        /// receiving it.
        live: bool,
    },
    /// The stream was received.
    Received,
    /// The request failed.
    Refused {
        /// Why.
        message: String,
    },
}

/// A snapshot, by name and guid (names can repeat across hosts; guids
/// identify the same snapshot on both).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PeerSnapshot {
    /// The part after `@`.
    pub name: String,
    /// ZFS's guid.
    pub guid: u64,
}

#[cfg(test)]
mod test;
