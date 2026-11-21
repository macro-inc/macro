//! What the move service needs from the host (datasets, peers, the host
//! service) and what it offers the inbound side ([`MoveOperations`]).

use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use firecracker_host_api::moves::{
    AdoptComputer, ExpectMove, MoveHolding, PeerSnapshot, Replicate, Replication,
};
use firecracker_host_api::{Computer, ComputerId};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::domain::service::HostError;

/// Where a computer's dataset is on a host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    /// Served by this host.
    Live,
    /// Received, or released: not served.
    Staged,
}

/// What a replication round sends its changes since.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendFrom {
    /// Everything (a computer that is not a clone).
    Nothing,
    /// A snapshot of the same dataset, by name.
    Snapshot(String),
    /// The golden snapshot the dataset is a clone of, by full name.
    Origin(String),
    /// The rest of an interrupted stream, by the target's resume token.
    Resume(String),
}

/// The golden snapshot a computer's dataset is a clone of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    /// `dataset@name`.
    pub full_name: String,
    /// Its guid, the same on every host that received it.
    pub guid: u64,
}

/// ZFS datasets of moving computers.
pub trait Replicas: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Snapshots of the computer's dataset at `place`, oldest first; empty
    /// when it is not there.
    fn snapshots(
        &self,
        place: Place,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Vec<PeerSnapshot>, Self::Err>> + Send;

    /// The golden snapshot the dataset at `place` is a clone of.
    fn origin(
        &self,
        place: Place,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<Origin>, Self::Err>> + Send;

    /// Snapshot the dataset at `place` as `@name`; returns its guid.
    fn snapshot(
        &self,
        place: Place,
        computer_id: ComputerId,
        name: &str,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// `zfs send` of `@snapshot` at `place` from `from` into `sink`,
    /// counting bytes into `progress`.
    fn send(
        &self,
        place: Place,
        computer_id: ComputerId,
        from: &SendFrom,
        snapshot: &str,
        sink: &mut (impl AsyncWrite + Unpin + Send),
        progress: &AtomicU64,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// `zfs send` of a golden snapshot in full, for a target that lacks it.
    fn send_base(
        &self,
        origin: &Origin,
        sink: &mut (impl AsyncWrite + Unpin + Send),
        progress: &AtomicU64,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// `zfs receive` of a stream of the computer into its staged dataset
    /// (resumable); a first round is received as a clone of the base with
    /// `origin_guid`.
    fn receive(
        &self,
        computer_id: ComputerId,
        origin_guid: Option<u64>,
        source: &mut (impl AsyncRead + Unpin + Send),
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// `zfs receive` of a golden snapshot, kept as a base.
    fn receive_base(
        &self,
        guid: u64,
        source: &mut (impl AsyncRead + Unpin + Send),
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Guids of the golden snapshots kept as bases.
    fn bases(&self) -> impl Future<Output = Result<Vec<u64>, Self::Err>> + Send;

    /// The staged dataset's resume token after an interrupted receive.
    fn resume_token(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Move the live dataset to staging (unserved).
    fn stage(&self, computer_id: ComputerId) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Move the staged dataset back to live, mounted, with the computer's
    /// quota.
    fn unstage(
        &self,
        computer_id: ComputerId,
        refquota_bytes: u64,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Mount the staged dataset, so its record can be read.
    fn mount_staged(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Every computer with a staged dataset.
    fn staged(&self) -> impl Future<Output = Result<Vec<ComputerId>, Self::Err>> + Send;

    /// Destroy the staged dataset; absent is fine.
    fn drop_staged(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Destroy this module's snapshots at `place` older than `keep`.
    fn prune(
        &self,
        place: Place,
        computer_id: ComputerId,
        keep: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Connections to other hosts' move listeners.
pub trait Peers: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;
    /// A connection.
    type Connection: AsyncRead + AsyncWrite + Unpin + Send + 'static;

    /// Connect to `target` (`address:port`).
    fn connect(
        &self,
        target: &str,
    ) -> impl Future<Output = Result<Self::Connection, Self::Err>> + Send;
}

/// What a move needs from the host service, under each computer's
/// lock.
pub trait MoveHost: Send + Sync + 'static {
    /// Whether the computer is live here.
    fn is_live(&self, computer_id: ComputerId) -> impl Future<Output = bool> + Send;

    /// Stop the guest (or discard its hibernation), save it stopped, run
    /// `stage`, and stop serving it. Safe to repeat once staged.
    fn release<Staging>(
        &self,
        computer_id: ComputerId,
        stage: Staging,
    ) -> impl Future<Output = Result<(), HostError>> + Send
    where
        Staging: Future<Output = Result<(), HostError>> + Send;

    /// Run `unstage` (given the quota the received record asks for), then
    /// serve the received record, stopped. Answers the computer as is when
    /// it is already live for the same control plane and generation.
    fn adopt<Unstaging, Unstage>(
        &self,
        computer_id: ComputerId,
        request: &AdoptComputer,
        unstage: Unstage,
    ) -> impl Future<Output = Result<Computer, HostError>> + Send
    where
        Unstage: FnOnce(u64) -> Unstaging + Send,
        Unstaging: Future<Output = Result<(), HostError>> + Send;

    /// Refuse creating these computers (staged here) until adopted or
    /// dropped.
    fn set_staged(&self, computer_id: ComputerId, staged: bool);
}

/// What the move routes and the move listener ask of a host: the inbound
/// side's port, so the routes are tested with a fake.
pub trait MoveOperations: Send + Sync + 'static {
    /// The computer's last replication round.
    fn replication(&self, computer_id: ComputerId) -> Replication;

    /// Start (or join) a round to the target.
    fn replicate(
        self: Arc<Self>,
        computer_id: ComputerId,
        request: Replicate,
    ) -> impl Future<Output = Result<Replication, HostError>> + Send;

    /// Stop serving the computer so the next round is the final one.
    fn release(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<MoveHolding, HostError>> + Send;

    /// What this host holds of the computer.
    fn move_holding(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<MoveHolding, HostError>> + Send;

    /// Accept the computer from a source holding the ticket.
    fn expect(
        &self,
        computer_id: ComputerId,
        request: ExpectMove,
    ) -> impl Future<Output = Result<MoveHolding, HostError>> + Send;

    /// Destroy the staged copy; never the live computer.
    fn drop_staged(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), HostError>> + Send;

    /// Serve the staged computer.
    fn adopt(
        &self,
        computer_id: ComputerId,
        request: AdoptComputer,
    ) -> impl Future<Output = Result<Computer, HostError>> + Send;

    /// Answer one connection on the move listener.
    fn serve_peer(
        &self,
        connection: impl AsyncRead + AsyncWrite + Unpin + Send,
    ) -> impl Future<Output = ()> + Send;
}
