//! Moving computers between hosts ([`firecracker_host_api::moves`]):
//! replication rounds this host sends as a source, streams it receives as a
//! target, and the release/adopt hand-over.
//!
//! The source pushes: it asks the target what it holds, snapshots the
//! computer, and streams `zfs send` from the newest snapshot both have (or
//! from the computer's golden snapshot, which the target keeps as a base).
//! Nothing here stops or starts a guest except through [`MoveHost`],
//! which runs under the computer's lock.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;
use firecracker_host_api::moves::{
    AdoptComputer, ExpectMove, MoveHolding, PeerAnswer, PeerOperation, PeerRequest, Replicate,
    Replication, ReplicationState,
};
use firecracker_host_api::{Computer, ComputerId};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio_util::task::TaskTracker;
use tracing::Instrument;

use crate::domain::service::HostError;

mod ports;
mod telemetry;
#[cfg(test)]
mod test;
mod wire;

pub use ports::{MoveHost, MoveOperations, Origin, Peers, Place, Replicas, SendFrom};
use wire::{io_error, peer_refused, read_answer, read_line, write_line};

/// Longest request or answer line on the move listener.
pub const MAX_PEER_LINE_BYTES: usize = 64 * 1024;
/// Snapshots this module makes are named `<prefix><time>`; only those are
/// ever pruned.
pub const SNAPSHOT_PREFIX: &str = "move-";

/// What a pushed stream carries.
enum Payload<'a> {
    /// The computer's dataset.
    Computer {
        place: Place,
        from: &'a SendFrom,
        snapshot: &'a str,
    },
    /// A golden snapshot, in full.
    Base(&'a Origin),
}

struct Round {
    replication: Replication,
    progress: Arc<AtomicU64>,
}

/// Replication rounds and the move listener's requests.
pub struct MoveService<Host, Datasets, Connections> {
    host: Arc<Host>,
    replicas: Datasets,
    peers: Connections,
    tasks: TaskTracker,
    /// Tickets this host accepts as a target.
    expected: std::sync::Mutex<HashMap<ComputerId, ExpectMove>>,
    /// The last round of each computer this host sent.
    rounds: std::sync::Mutex<HashMap<ComputerId, Round>>,
}

fn replicas_error(error: impl std::error::Error + Send + Sync + 'static) -> HostError {
    HostError::Internal(rootcause::Report::new(error).into_dynamic())
}

impl<Host: MoveHost, Datasets: Replicas, Connections: Peers>
    MoveService<Host, Datasets, Connections>
{
    /// A service over the host, its datasets and its peers, marking every
    /// staged computer so the host refuses creating it.
    pub async fn start(
        host: Arc<Host>,
        replicas: Datasets,
        peers: Connections,
        tasks: TaskTracker,
    ) -> Result<Self, HostError> {
        for computer_id in replicas.staged().await.map_err(replicas_error)? {
            host.set_staged(computer_id, true);
        }
        Ok(Self {
            host,
            replicas,
            peers,
            tasks,
            expected: std::sync::Mutex::new(HashMap::new()),
            rounds: std::sync::Mutex::new(HashMap::new()),
        })
    }

    /// What this host holds of the computer.
    pub async fn move_holding(&self, computer_id: ComputerId) -> Result<MoveHolding, HostError> {
        let staged = self
            .replicas
            .snapshots(Place::Staged, computer_id)
            .await
            .map_err(replicas_error)?;
        let staged_present = !staged.is_empty()
            || self
                .replicas
                .staged()
                .await
                .map_err(replicas_error)?
                .contains(&computer_id);
        Ok(MoveHolding {
            computer_id,
            live: self.host.is_live(computer_id).await,
            staged: staged_present,
            snapshots: staged.into_iter().map(|snapshot| snapshot.name).collect(),
        })
    }

    /// Accept the computer from a source holding `request.ticket`.
    #[tracing::instrument(name = "firecracker_host.move.expect", skip_all, fields(computer_id = %computer_id), err)]
    pub async fn expect(
        &self,
        computer_id: ComputerId,
        request: ExpectMove,
    ) -> Result<MoveHolding, HostError> {
        if request.ticket.expose().len() < 32 {
            return Err(HostError::MoveRefused(
                "a move ticket has at least 32 characters".to_owned(),
            ));
        }
        self.expected
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(computer_id, request);
        self.move_holding(computer_id).await
    }

    /// The computer's last round.
    pub fn replication(&self, computer_id: ComputerId) -> Replication {
        let rounds = self
            .rounds
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match rounds.get(&computer_id) {
            Some(round) => Replication {
                bytes: round.progress.load(Ordering::Relaxed),
                ..round.replication.clone()
            },
            None => Replication {
                state: ReplicationState::Idle,
                released: false,
                snapshot: None,
                incremental_from: None,
                bytes: 0,
                started_at: None,
                finished_at: None,
            },
        }
    }

    fn running(&self, computer_id: ComputerId) -> bool {
        self.rounds
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&computer_id)
            .is_some_and(|round| round.replication.state == ReplicationState::Running)
    }

    /// Start a round to the target unless one runs; answers it.
    pub async fn replicate(
        self: &Arc<Self>,
        computer_id: ComputerId,
        request: Replicate,
    ) -> Result<Replication, HostError> {
        let place = if self.host.is_live(computer_id).await {
            Place::Live
        } else if self
            .replicas
            .staged()
            .await
            .map_err(replicas_error)?
            .contains(&computer_id)
        {
            Place::Staged
        } else {
            return Err(HostError::NotFound(computer_id));
        };
        let progress = {
            let mut rounds = self
                .rounds
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(round) = rounds.get(&computer_id)
                && round.replication.state == ReplicationState::Running
            {
                return Ok(Replication {
                    bytes: round.progress.load(Ordering::Relaxed),
                    ..round.replication.clone()
                });
            }
            let progress = Arc::new(AtomicU64::new(0));
            rounds.insert(
                computer_id,
                Round {
                    replication: Replication {
                        state: ReplicationState::Running,
                        released: place == Place::Staged,
                        snapshot: None,
                        incremental_from: None,
                        bytes: 0,
                        started_at: Some(Utc::now()),
                        finished_at: None,
                    },
                    progress: progress.clone(),
                },
            );
            progress
        };
        let span = tracing::info_span!(
            "firecracker_host.move.replicate",
            computer_id = %computer_id,
            released = place == Place::Staged,
            snapshot = tracing::field::Empty,
            incremental_from = tracing::field::Empty,
            bytes = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        let service = self.clone();
        self.tasks.spawn(
            async move {
                let outcome = service.round(computer_id, place, &request, &progress).await;
                let span = tracing::Span::current();
                span.record("bytes", progress.load(Ordering::Relaxed));
                let mut rounds = service
                    .rounds
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if let Some(round) = rounds.get_mut(&computer_id) {
                    round.replication.finished_at = Some(Utc::now());
                    match outcome {
                        Ok((snapshot, from)) => {
                            span.record("snapshot", snapshot.as_str());
                            if let Some(from) = &from {
                                span.record("incremental_from", from.as_str());
                            }
                            round.replication.state = ReplicationState::Done;
                            round.replication.snapshot = Some(snapshot);
                            round.replication.incremental_from = from;
                        }
                        Err(error) => {
                            span.record("otel.status_code", "ERROR");
                            tracing::warn!(error = ?error, "replication round failed");
                            round.replication.state = ReplicationState::Failed {
                                message: error.to_string(),
                            };
                        }
                    }
                }
            }
            .instrument(span),
        );
        Ok(self.replication(computer_id))
    }

    /// One round: resume an interrupted stream if the target has one, then
    /// send a new snapshot from the newest one both hosts hold. Returns the
    /// snapshot and what it was incremental from.
    async fn round(
        &self,
        computer_id: ComputerId,
        place: Place,
        request: &Replicate,
        progress: &AtomicU64,
    ) -> Result<(String, Option<String>), HostError> {
        let state = self.ask(request, computer_id, PeerOperation::State).await?;
        let PeerAnswer::State {
            snapshots: theirs,
            resume_token,
            bases,
            live,
        } = state
        else {
            return Err(peer_refused(state));
        };
        if live {
            return Err(HostError::MoveRefused(format!(
                "computer {computer_id} is live on the target"
            )));
        }
        if let Some(token) = resume_token {
            self.push(
                request,
                computer_id,
                PeerOperation::Receive { origin_guid: None },
                Payload::Computer {
                    place,
                    from: &SendFrom::Resume(token),
                    snapshot: "",
                },
                progress,
            )
            .await?;
            return Box::pin(self.round(computer_id, place, request, progress)).await;
        }

        let ours = self
            .replicas
            .snapshots(place, computer_id)
            .await
            .map_err(replicas_error)?;
        let common = ours
            .iter()
            .rev()
            .find(|snapshot| theirs.iter().any(|their| their.guid == snapshot.guid));
        let snapshot = format!(
            "{SNAPSHOT_PREFIX}{}",
            Utc::now().format("%Y%m%dT%H%M%S%3fZ")
        );
        self.replicas
            .snapshot(place, computer_id, &snapshot)
            .await
            .map_err(replicas_error)?;
        let (from, origin_guid) = match common {
            Some(common) => (SendFrom::Snapshot(common.name.clone()), None),
            None => match self
                .replicas
                .origin(place, computer_id)
                .await
                .map_err(replicas_error)?
            {
                Some(origin) => {
                    if !bases.contains(&origin.guid) {
                        self.push(
                            request,
                            computer_id,
                            PeerOperation::ReceiveBase { guid: origin.guid },
                            Payload::Base(&origin),
                            progress,
                        )
                        .await?;
                    }
                    (SendFrom::Origin(origin.full_name), Some(origin.guid))
                }
                None => (SendFrom::Nothing, None),
            },
        };
        self.push(
            request,
            computer_id,
            PeerOperation::Receive { origin_guid },
            Payload::Computer {
                place,
                from: &from,
                snapshot: &snapshot,
            },
            progress,
        )
        .await?;
        self.replicas
            .prune(place, computer_id, &snapshot)
            .await
            .map_err(replicas_error)?;
        let from = match from {
            SendFrom::Snapshot(name) | SendFrom::Origin(name) => Some(name),
            SendFrom::Nothing | SendFrom::Resume(_) => None,
        };
        Ok((snapshot, from))
    }

    async fn ask(
        &self,
        request: &Replicate,
        computer_id: ComputerId,
        operation: PeerOperation,
    ) -> Result<PeerAnswer, HostError> {
        let mut connection = self
            .peers
            .connect(&request.target)
            .await
            .map_err(replicas_error)?;
        write_line(
            &mut connection,
            &PeerRequest {
                computer_id,
                ticket: request.ticket.clone(),
                operation,
                trace_context: telemetry::traceparent(),
            },
        )
        .await?;
        connection.shutdown().await.map_err(io_error)?;
        read_answer(&mut connection).await
    }

    /// Send a request line, then `payload` as a `zfs send` stream, then
    /// read the answer.
    async fn push(
        &self,
        request: &Replicate,
        computer_id: ComputerId,
        operation: PeerOperation,
        payload: Payload<'_>,
        progress: &AtomicU64,
    ) -> Result<(), HostError> {
        let mut connection = self
            .peers
            .connect(&request.target)
            .await
            .map_err(replicas_error)?;
        write_line(
            &mut connection,
            &PeerRequest {
                computer_id,
                ticket: request.ticket.clone(),
                operation,
                trace_context: telemetry::traceparent(),
            },
        )
        .await?;
        let sent = match payload {
            Payload::Computer {
                place,
                from,
                snapshot,
            } => {
                self.replicas
                    .send(
                        place,
                        computer_id,
                        from,
                        snapshot,
                        &mut connection,
                        progress,
                    )
                    .await
            }
            Payload::Base(origin) => {
                self.replicas
                    .send_base(origin, &mut connection, progress)
                    .await
            }
        };
        sent.map_err(replicas_error)?;
        connection.shutdown().await.map_err(io_error)?;
        match read_answer(&mut connection).await? {
            PeerAnswer::Received => Ok(()),
            answer => Err(peer_refused(answer)),
        }
    }

    /// Answer one connection on the move listener, in the source's trace.
    pub async fn serve_peer(&self, connection: impl AsyncRead + AsyncWrite + Unpin + Send) {
        let (reader, mut writer) = tokio::io::split(connection);
        let mut reader = BufReader::new(reader);
        let span = tracing::info_span!(
            "firecracker_host.move.peer",
            computer_id = tracing::field::Empty,
            operation = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        let request = read_line::<PeerRequest>(&mut reader).await;
        if let Ok(request) = &request {
            telemetry::join(&span, request.trace_context.as_deref());
        }
        let answer = async {
            match request {
                Ok(request) => self.answer_peer(request, &mut reader).await,
                Err(error) => Err(error),
            }
        }
        .instrument(span.clone())
        .await
        .unwrap_or_else(|error| {
            span.record("otel.status_code", "ERROR");
            tracing::warn!(parent: &span, error = ?error, "move request refused");
            PeerAnswer::Refused {
                message: error.to_string(),
            }
        });
        if let Err(error) = write_line(&mut writer, &answer).await {
            tracing::warn!(parent: &span, error = ?error, "move answer not delivered");
        }
        let _ = writer.shutdown().await;
    }

    async fn answer_peer(
        &self,
        request: PeerRequest,
        reader: &mut (impl AsyncBufReadExt + Unpin + Send),
    ) -> Result<PeerAnswer, HostError> {
        let span = tracing::Span::current();
        span.record("computer_id", tracing::field::display(request.computer_id));
        self.check_ticket(&request)?;
        let computer_id = request.computer_id;
        match request.operation {
            PeerOperation::State => {
                span.record("operation", "state");
                Ok(PeerAnswer::State {
                    snapshots: self
                        .replicas
                        .snapshots(Place::Staged, computer_id)
                        .await
                        .map_err(replicas_error)?,
                    resume_token: self
                        .replicas
                        .resume_token(computer_id)
                        .await
                        .map_err(replicas_error)?,
                    bases: self.replicas.bases().await.map_err(replicas_error)?,
                    live: self.host.is_live(computer_id).await,
                })
            }
            PeerOperation::Receive { origin_guid } => {
                span.record("operation", "receive");
                if self.host.is_live(computer_id).await {
                    return Err(HostError::MoveRefused(format!(
                        "computer {computer_id} is live here"
                    )));
                }
                self.host.set_staged(computer_id, true);
                self.replicas
                    .receive(computer_id, origin_guid, reader)
                    .await
                    .map_err(replicas_error)?;
                if let Some(newest) = self
                    .replicas
                    .snapshots(Place::Staged, computer_id)
                    .await
                    .map_err(replicas_error)?
                    .last()
                {
                    self.replicas
                        .prune(Place::Staged, computer_id, &newest.name)
                        .await
                        .map_err(replicas_error)?;
                }
                Ok(PeerAnswer::Received)
            }
            PeerOperation::ReceiveBase { guid } => {
                span.record("operation", "receive_base");
                if !self
                    .replicas
                    .bases()
                    .await
                    .map_err(replicas_error)?
                    .contains(&guid)
                {
                    self.replicas
                        .receive_base(guid, reader)
                        .await
                        .map_err(replicas_error)?;
                }
                Ok(PeerAnswer::Received)
            }
        }
    }

    fn check_ticket(&self, request: &PeerRequest) -> Result<(), HostError> {
        let expected = self
            .expected
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let accepted = expected.get(&request.computer_id).is_some_and(|expected| {
            // `MoveTicket` compares in constant time.
            expected.expires_at > Utc::now() && expected.ticket == request.ticket
        });
        if accepted {
            Ok(())
        } else {
            Err(HostError::MoveRefused(format!(
                "no move of {} expected with this ticket",
                request.computer_id
            )))
        }
    }

    /// Stop serving the computer so the next round is the final one.
    #[tracing::instrument(name = "firecracker_host.move.release", skip(self), err)]
    pub async fn release(&self, computer_id: ComputerId) -> Result<MoveHolding, HostError> {
        if self.running(computer_id) {
            return Err(HostError::Busy(
                "a replication round is running; release after it".to_owned(),
            ));
        }
        let staged = self
            .replicas
            .staged()
            .await
            .map_err(replicas_error)?
            .contains(&computer_id);
        if !staged {
            self.host
                .release(computer_id, async {
                    self.replicas
                        .stage(computer_id)
                        .await
                        .map_err(replicas_error)
                })
                .await?;
        }
        self.host.set_staged(computer_id, true);
        self.move_holding(computer_id).await
    }

    /// Serve the staged computer.
    #[tracing::instrument(name = "firecracker_host.move.adopt", skip(self, request), err)]
    pub async fn adopt(
        &self,
        computer_id: ComputerId,
        request: AdoptComputer,
    ) -> Result<Computer, HostError> {
        if self.running(computer_id) {
            return Err(HostError::Busy(
                "a replication round of this computer is running".to_owned(),
            ));
        }
        if !self.host.is_live(computer_id).await {
            self.replicas
                .mount_staged(computer_id)
                .await
                .map_err(replicas_error)?;
        }
        let computer = self
            .host
            .adopt(computer_id, &request, |refquota_bytes| async move {
                self.replicas
                    .unstage(computer_id, refquota_bytes)
                    .await
                    .map_err(replicas_error)
            })
            .await?;
        self.host.set_staged(computer_id, false);
        self.expected
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&computer_id);
        Ok(computer)
    }

    /// Destroy the staged copy; never the live computer.
    #[tracing::instrument(name = "firecracker_host.move.drop_staged", skip(self), err)]
    pub async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), HostError> {
        if self.running(computer_id) {
            return Err(HostError::Busy(
                "a replication round of this computer is running".to_owned(),
            ));
        }
        self.replicas
            .drop_staged(computer_id)
            .await
            .map_err(replicas_error)?;
        self.host.set_staged(computer_id, false);
        self.expected
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&computer_id);
        Ok(())
    }
}

impl<Host: MoveHost, Datasets: Replicas, Connections: Peers> MoveOperations
    for MoveService<Host, Datasets, Connections>
{
    fn replication(&self, computer_id: ComputerId) -> Replication {
        MoveService::replication(self, computer_id)
    }

    async fn replicate(
        self: Arc<Self>,
        computer_id: ComputerId,
        request: Replicate,
    ) -> Result<Replication, HostError> {
        MoveService::replicate(&self, computer_id, request).await
    }

    async fn release(&self, computer_id: ComputerId) -> Result<MoveHolding, HostError> {
        MoveService::release(self, computer_id).await
    }

    async fn move_holding(&self, computer_id: ComputerId) -> Result<MoveHolding, HostError> {
        MoveService::move_holding(self, computer_id).await
    }

    async fn expect(
        &self,
        computer_id: ComputerId,
        request: ExpectMove,
    ) -> Result<MoveHolding, HostError> {
        MoveService::expect(self, computer_id, request).await
    }

    async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), HostError> {
        MoveService::drop_staged(self, computer_id).await
    }

    async fn adopt(
        &self,
        computer_id: ComputerId,
        request: AdoptComputer,
    ) -> Result<Computer, HostError> {
        MoveService::adopt(self, computer_id, request).await
    }

    async fn serve_peer(&self, connection: impl AsyncRead + AsyncWrite + Unpin + Send) {
        MoveService::serve_peer(self, connection).await;
    }
}
