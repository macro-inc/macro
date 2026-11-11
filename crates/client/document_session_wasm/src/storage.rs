use crate::*;
use doc_sync_core::*;
pub(crate) fn record(r: wire::WalRecordMsg) -> WalRecord {
    WalRecord {
        seq: WalSeq(r.seq),
        created_at: UnixMillis(r.created_at),
        user: UserKey(r.user),
        foreign: r.foreign,
        quarantined: r.quarantined,
        bytes: r.bytes,
    }
}
pub(crate) fn wire_record(r: &WalRecord) -> wire::WalRecordMsg {
    wire::WalRecordMsg {
        seq: r.seq.0,
        created_at: r.created_at.0,
        user: r.user.0.clone(),
        foreign: r.foreign,
        quarantined: r.quarantined,
        delivered: false,
        bytes: r.bytes.clone(),
    }
}
pub(crate) fn empty_record() -> wire::WalRecordMsg {
    wire::WalRecordMsg {
        seq: 0,
        created_at: 0,
        user: String::new(),
        foreign: false,
        quarantined: false,
        delivered: false,
        bytes: vec![],
    }
}
pub(crate) fn owner(text: &str) -> Result<WalOwner, BoundaryError> {
    if text.is_empty() {
        Ok(WalOwner::Legacy)
    } else {
        Ok(WalOwner::Session(codec::session(text)?))
    }
}
pub(crate) fn owner_string(owner: &WalOwner) -> String {
    match owner {
        WalOwner::Legacy => String::new(),
        WalOwner::Session(id) => id.0.to_string(),
    }
}
pub(crate) fn loaded(msg: wire::LocalStateMsg) -> Result<LocalState, BoundaryError> {
    fn rows(rows: Vec<wire::OwnerRowsMsg>) -> Result<Vec<OrphanWal>, BoundaryError> {
        rows.into_iter()
            .map(|r| {
                Ok(OrphanWal {
                    owner: owner(&r.owner)?,
                    records: r
                        .records
                        .into_iter()
                        .map(|r| StoredWalRecord {
                            delivered: r.delivered,
                            record: record(r),
                        })
                        .collect(),
                })
            })
            .collect()
    }
    Ok(LocalState {
        snapshot: if msg.snapshot.is_empty() {
            None
        } else {
            Some(StoredSnapshot {
                bytes: msg.snapshot,
                covers: if msg.covers_owner.is_empty() {
                    None
                } else {
                    Some((codec::session(&msg.covers_owner)?, WalSeq(msg.covers_seq)))
                },
            })
        },
        orphans: rows(msg.orphans)?,
        assist: rows(msg.assist)?,
    })
}
pub(crate) fn encode(op: &StorageOp, terminal: bool) -> wire::StorageOpMsg {
    let mut m = wire::StorageOpMsg {
        kind: 0,
        doc: String::new(),
        owner: String::new(),
        user: String::new(),
        from: String::new(),
        seq: 0,
        through: 0,
        before: 0,
        retry: false,
        terminal,
        record: empty_record(),
        snapshot: vec![],
        covers_owner: String::new(),
        covers_seq: 0,
        expected: vec![],
    };
    match op {
        StorageOp::Load { doc, owner, user } | StorageOp::LoadOrphans { doc, owner, user } => {
            m.kind = if matches!(op, StorageOp::Load { .. }) {
                0
            } else {
                1
            };
            m.doc = doc.to_string();
            m.owner = owner.0.to_string();
            m.user = user.0.clone();
        }
        StorageOp::WalAppend {
            doc,
            owner,
            record,
            retry,
        } => {
            m.kind = 2;
            m.doc = doc.to_string();
            m.owner = owner.0.to_string();
            m.record = wire_record(record);
            m.retry = *retry;
        }
        StorageOp::WalMarkDelivered {
            doc,
            owner,
            through,
        }
        | StorageOp::WalPrune {
            doc,
            owner,
            through,
        } => {
            m.kind = if matches!(op, StorageOp::WalMarkDelivered { .. }) {
                3
            } else {
                4
            };
            m.doc = doc.to_string();
            m.owner = owner.0.to_string();
            m.through = through.0;
        }
        StorageOp::WalAdopt {
            doc,
            from,
            to,
            first_seq,
            covers,
            expected,
        } => {
            m.kind = 5;
            m.doc = doc.to_string();
            m.from = owner_string(from);
            m.owner = to.0.to_string();
            m.seq = first_seq.0;
            m.through = covers.0;
            m.expected = expected
                .iter()
                .map(|row| wire::WalRecordMsg {
                    delivered: row.delivered,
                    ..wire_record(&row.record)
                })
                .collect();
        }
        StorageOp::WalDropExpired { doc, from, before } => {
            m.kind = 6;
            m.doc = doc.to_string();
            m.from = owner_string(from);
            m.before = before.0;
        }
        StorageOp::WalQuarantine { doc, owner, seq } => {
            m.kind = 7;
            m.doc = doc.to_string();
            m.owner = owner.0.to_string();
            m.seq = seq.0;
        }
        StorageOp::SnapshotSave { doc, bytes, covers } => {
            m.kind = 8;
            m.doc = doc.to_string();
            m.snapshot = bytes.clone();
            if let Some((id, seq)) = covers {
                m.covers_owner = id.0.to_string();
                m.covers_seq = seq.0;
            }
        }
        StorageOp::SnapshotDelete { doc } => {
            m.kind = 9;
            m.doc = doc.to_string();
        }
    }
    m
}
