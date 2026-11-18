/// Document operations supplied by the session and its projection.
pub trait SyncDoc {
    /// The current doc instance's peer. A fresh peer id per LoroDoc instance (cold start,
    /// reset), never reused (§1.8).
    fn peer_id(&self) -> loro::PeerID;

    /// Current operation-log version vector, including imported history.
    fn oplog_vv(&self) -> loro::VersionVector;

    /// Current causal DAG heads, captured only when establishing a confirmed base.
    /// Version-vector peer heads may name collected history below a shallow root.
    fn oplog_frontiers(&self) -> loro::Frontiers;

    /// Import remote bytes. For an editor, this runs the projection and queues the
    /// resulting view diff inside the session.
    fn import_remote(
        &mut self,
        bytes: &[u8],
        origin: ImportOrigin,
    ) -> Result<Imported, ImportFailure>;

    /// Only the current peer's ops in `since..oplog_vv`, as one `updates-in-range` export.
    /// `Ok(None)` when there is nothing new. Replaces `getUpdateSince` (manager.ts).
    fn export_local(&self, since: &loro::VersionVector) -> Result<Option<Vec<u8>>, ExportFailure>;

    /// `shallow-snapshot` at `at`: the frontiers of the last completed convergence (a
    /// server-confirmed base, S-1'), never the current frontier at persistence time (Δ from engine.ts
    /// `persistSnapshot`). Ops after `at` stay in the snapshot as history above the root, so a
    /// concurrent remote op made after the base imports without a rebase.
    fn export_shallow_snapshot(&self, at: &loro::Frontiers) -> Result<Vec<u8>, ExportFailure>;

    /// Pure operation counts for the requested base and current cached shallow root.
    fn snapshot_stats(&self, at: &loro::Frontiers) -> crate::SnapshotStats;

    /// Import `bytes` into a throwaway `LoroDoc` seeded from `snapshot`, peer from the supply
    /// and never committed. Used only by the W-11 poison proof.
    fn probe_import(
        &mut self,
        snapshot: &[u8],
        bytes: &[u8],
        new_peer: loro::PeerID,
    ) -> Result<Imported, ImportFailure>;

    /// Seed an empty doc. First-wins is decided by the core, not here.
    fn seed(&mut self, snapshot: &[u8], kind: SeedKind) -> Result<(), ImportFailure>;

    /// Throw this instance away and load `snapshot` into a new one with `new_peer`, set by
    /// `set_peer_id` right after `LoroDoc::new()` and before the import (D-4b).
    /// The snapshot must be self-contained: `pending` is an error (manager.ts `reset`).
    fn replace(&mut self, snapshot: &[u8], new_peer: loro::PeerID) -> Result<(), ImportFailure>;
}

/// `new_ops`: the import grew the oplog vv (W-10.2 stores chatter only then).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Imported {
    /// Whether the visible document state changed.
    pub changed: bool,
    /// Whether import awaits missing dependencies.
    pub pending: bool,
    /// Whether the operation-log version vector grew.
    pub new_ops: bool,
}

/// Source of bytes imported into the document.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportOrigin {
    /// Bytes received from the live transport.
    Live,
    /// Bytes received from a co-located session.
    Chatter,
    /// Bytes received during convergence.
    Catchup,
    /// Bytes recovered from the durable WAL.
    WalReplay,
    /// A comment update echoed by the server.
    CommentEcho,
}

/// Source of the winning initial document snapshot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeedKind {
    /// Host-provided optimistic initial bytes.
    Optimistic,
    /// Snapshot loaded from local durable storage.
    Local,
    /// Host-provided cached remote snapshot.
    CachedS3,
    /// Fresh snapshot received from the sync service.
    Remote,
}

/// Import failure.
#[derive(Debug, thiserror::Error)]
pub enum ImportFailure {
    /// Loro rejected the imported bytes.
    #[error("loro rejected the update")]
    Loro(#[source] loro::LoroError),
    /// Loro `ImportUpdatesThatDependsOnOutdatedVersion`: the bytes depend on ops below this
    /// doc's shallow root. Not corruption: it starts a rebase (I-2'), never a budgeted reset.
    #[error("update depends on history below the shallow root")]
    Outdated,
    /// The editor projection rejected the import.
    #[error("projection failed")]
    Projection(rootcause::Report),
}

/// Failure while exporting document history.
#[derive(Debug, thiserror::Error)]
pub enum ExportFailure {
    /// Loro could not encode the requested history.
    #[error("loro export failed")]
    Loro(#[source] loro::LoroError),
}
