use crate::*;

/// Durable fields for a single write-ahead-log row.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WalRecord {
    /// Sequence number within one owner’s WAL.
    pub seq: WalSeq,
    /// Wall-clock timestamp when the row was created.
    #[serde(with = "wall_millis")]
    pub created_at: UnixMillis,
    /// Opaque signed-in user identity used to isolate WAL ownership.
    pub user: UserKey,
    /// Bytes this session imported from chatter and stores on behalf of their writer (W-10).
    /// `export_local` never re-exports them; they are delivered per W-10.5 and pruned like own
    /// rows, and never posted to chatter.
    pub foreign: bool,
    /// Parked as proven poison (W-11). Kept until TTL, never pushed, never deleted early.
    pub quarantined: bool,
    /// Opaque serialized document bytes.
    pub bytes: Vec<u8>,
}

/// A row as read back from the store.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StoredWalRecord {
    /// Durable WAL row contents.
    pub record: WalRecord,
    /// Whether the server durably acknowledged this row.
    pub delivered: bool,
}

/// An ordered, per-document durable storage operation.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum StorageOp {
    /// The snapshot, plus every orphaned owner's rows for `doc` (O-2) and, read-only, every
    /// live foreign owner's undelivered rows (`assist`, O-5). Rows of a different `user` are
    /// never returned (O-2).
    Load {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Opaque signed-in user identity used to isolate WAL ownership.
        user: UserKey,
    },
    /// Re-read orphans and assist rows only (on every `Synced`, on `ChatterMessage::Closing`,
    /// and when convergence ends still pending).
    LoadOrphans {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Opaque signed-in user identity used to isolate WAL ownership.
        user: UserKey,
    },
    /// Idempotent on `(doc, owner, seq)`: a row that already exists is left as is (SC-6).
    /// `retry` is true only on the re-emit after `Uncertain` (SC-3); only then does the IDB
    /// adapter scan for an existing row (§4.4).
    WalAppend {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Durable WAL row contents.
        record: WalRecord,
        /// Whether this repeats an append with an uncertain outcome.
        retry: bool,
    },
    /// Set `delivered` on every row of `owner` with seq ≤ `through`, in one transaction.
    WalMarkDelivered {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Inclusive sequence bound for this operation.
        through: WalSeq,
    },
    /// Delete own rows with seq ≤ `through`. Issued only after a snapshot covering them is
    /// durable and they are delivered (W-9).
    WalPrune {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Inclusive sequence bound for this operation.
        through: WalSeq,
    },
    /// One transaction, conditional on each row's `owner == from`: rewrite `owner` to `to` and
    /// renumber `seq` from `first_seq` in place, for every row of `from` with
    /// `seq > covers_for(from)` or `!delivered`, preserving `delivered`, `created_at`, `user`
    /// `foreign` and `quarantined`; delete the rest of `from`'s rows (delivered and covered by the snapshot).
    /// `covers_for(from)` is the snapshot's `covers.seq` when `covers.owner == from`, else 0.
    /// Atomic for legacy rows too (no copy-then-delete).
    WalAdopt {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Previous or expiring WAL owner.
        from: WalOwner,
        /// Session receiving adopted rows.
        to: SessionId,
        /// First sequence assigned to adopted rows.
        first_seq: WalSeq,
        /// WAL prefix already represented by the stored snapshot.
        covers: WalSeq,
    },
    /// Drop `from`'s undelivered rows with `created_at < before` (TTL, W-7). `from` is an orphan,
    /// `Legacy`, or another user's owner (O-2: `Load` reports other users' expired rows for this
    /// op only), never a live owner.
    WalDropExpired {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Previous or expiring WAL owner.
        from: WalOwner,
        /// Exclusive wall-clock expiry cutoff.
        #[serde(with = "wall_millis")]
        before: UnixMillis,
    },
    /// Park one own row proven poison (W-11): set `quarantined = true`. Never a delete; the
    /// row stays until TTL (W-7) so nothing a user typed is removed by inference.
    WalQuarantine {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Sequence number within one owner’s WAL.
        seq: WalSeq,
    },
    /// Snapshot save.
    SnapshotSave {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Opaque serialized document bytes.
        bytes: Vec<u8>,
        /// WAL prefix already represented by the stored snapshot.
        covers: Option<(SessionId, WalSeq)>,
    },
    /// Snapshot delete.
    SnapshotDelete {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
    },
}

/// A correlated completion from the storage executor.
pub enum StorageEvent {
    /// A load operation completed.
    Loaded {
        /// Storage operation correlation identifier.
        id: StorageOpId,
        /// Executor result for the correlated operation.
        result: Result<LocalState, StorageFailure>,
    },
    /// A write operation completed.
    Done {
        /// Storage operation correlation identifier.
        id: StorageOpId,
        /// Executor result for the correlated operation.
        result: Result<(), StorageFailure>,
    },
    /// `WalAdopt` completion: how many rows moved. Adopted rows enter `entries` only now, and
    /// only that many (0 when another tab won).
    Adopted {
        /// Storage operation correlation identifier.
        id: StorageOpId,
        /// Executor result for the correlated operation.
        result: Result<u32, StorageFailure>,
    },
}

/// Snapshot and eligible WAL rows returned by the storage executor.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LocalState {
    /// `None` also when the stored snapshot is empty (`byteLength == 0`, S5 §2.3
    /// `hasLocalSnapshot`): the executor maps `Some(empty)` to `None`.
    pub snapshot: Option<StoredSnapshot>, // { bytes, covers: Option<(SessionId, WalSeq)> }
    /// Owners with no live lease (O-2), plus `Legacy`. Same `user` only.
    pub orphans: Vec<OrphanWal>, // { owner: WalOwner, records: Vec<StoredWalRecord> }
    /// Undelivered rows of live foreign owners (frozen or old tabs), read-only (O-5).
    pub assist: Vec<OrphanWal>,
}

/// Storage failures; uncertain writes may be retried idempotently.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, thiserror::Error)]
pub enum StorageFailure {
    /// Storage could not be opened or reached.
    #[error("storage is unavailable")]
    Unavailable,
    /// The store refused the write due to quota.
    #[error("storage quota exceeded")]
    QuotaExceeded,
    /// Persisted bytes or metadata could not be decoded safely.
    #[error("stored data is corrupt")]
    Corrupt,
    /// The store can't tell whether the write committed (a Turso commit whose fsync result was
    /// lost, an IDB transaction aborted after `complete` was queued). Never triggers a wipe.
    #[error("storage commit outcome is uncertain")]
    Uncertain,
    /// An otherwise unclassified storage failure.
    #[error("storage operation failed")]
    Other,
}

/// Durable snapshot and the own WAL prefix it covers.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StoredSnapshot {
    /// Opaque serialized document bytes.
    pub bytes: Vec<u8>,
    /// WAL prefix already represented by the stored snapshot.
    pub covers: Option<(SessionId, WalSeq)>,
}
/// Rows belonging to a single absent or assisted owner, in sequence order.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OrphanWal {
    /// Session owning the row or load request.
    pub owner: WalOwner,
    /// Rows sorted in owner sequence order.
    pub records: Vec<StoredWalRecord>,
}

mod wall_millis {
    use serde::{Deserialize, Deserializer, Serializer};
    use sync_protocol::time::UnixMillis;
    pub fn serialize<S: Serializer>(value: &UnixMillis, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_i64(value.0)
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<UnixMillis, D::Error> {
        i64::deserialize(deserializer).map(UnixMillis)
    }
}
