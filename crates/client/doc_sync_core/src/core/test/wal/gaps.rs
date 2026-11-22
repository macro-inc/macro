use super::*;

#[test]
fn an_adopted_delta_waits_for_its_server_parent_then_delivers() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.settle();
    let owner = loro::LoroDoc::new();
    owner.set_peer_id(7).unwrap();
    owner.get_text("text").push_str("parent").unwrap();
    owner.commit();
    let before = owner.oplog_vv();
    let parent = owner.export(loro::ExportMode::all_updates()).unwrap();
    owner.get_text("text").push_str("child").unwrap();
    owner.commit();
    let bytes = owner.export(loro::ExportMode::updates(&before)).unwrap();
    let record = StoredWalRecord {
        delivered: false,
        record: WalRecord {
            seq: WalSeq(2),
            created_at: now(h.time).wall,
            user: h.core.config.user.clone(),
            foreign: false,
            quarantined: false,
            bytes,
        },
    };
    load_rows(&mut h, vec![record]);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, pending)| {
            matches!(pending.completion, StorageCompletion::Adopt { .. }).then_some(*id)
        })
        .unwrap();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    assert_eq!(h.core.wal.entries[0].park, Some(ParkReason::Gap));
    h.send(SyncInput::Tick);
    assert!(h.core.push.is_none());
    h.doc
        .import_remote(&parent, ImportOrigin::WalReplay)
        .unwrap();
    h.send(SyncInput::Tick);
    assert_eq!(h.core.wal.entries[0].park, Some(ParkReason::Gap));
    assert!(h.core.push.is_none());
    let valid = h.core.wal.entries[0].bytes.clone();
    let mut damaged = valid.to_vec();
    *damaged.last_mut().unwrap() ^= 1;
    h.core.wal.entries[0].bytes = damaged.into();
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&parent),
    });
    assert_eq!(h.core.wal.entries[0].park, Some(ParkReason::Gap));
    assert!(h.core.push.is_none());
    h.core.wal.entries[0].bytes = valid;
    h.send(SyncInput::Tick);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "parentchild");
    assert_eq!(h.core.wal.entries[0].park, None);
    assert_eq!(h.core.push.as_ref().unwrap().rows, [WalSeq(1)]);
    assert!(!h.core.is_delivered(WalSeq(1)));
    h.ack();
    assert!(h.core.is_delivered(WalSeq(1)));
}

#[test]
fn a_resolved_gap_waits_for_the_existing_push_before_becoming_eligible() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Durable);
    h.settle();
    let owner = loro::LoroDoc::new();
    owner.set_peer_id(7).unwrap();
    owner.get_text("text").push_str("parent").unwrap();
    owner.commit();
    let before = owner.oplog_vv();
    let parent = owner.export(loro::ExportMode::all_updates()).unwrap();
    owner.get_text("text").push_str("child").unwrap();
    owner.commit();
    let record = StoredWalRecord {
        delivered: false,
        record: WalRecord {
            seq: WalSeq(2),
            created_at: now(h.time).wall,
            user: h.core.config.user.clone(),
            foreign: false,
            quarantined: false,
            bytes: owner.export(loro::ExportMode::updates(&before)).unwrap(),
        },
    };
    load_rows(&mut h, vec![record]);
    let id = h
        .core
        .storage
        .iter()
        .find_map(|(id, pending)| {
            matches!(pending.completion, StorageCompletion::Adopt { .. }).then_some(*id)
        })
        .unwrap();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Ok(1),
    }));
    assert_eq!(h.core.wal.entries[0].park, Some(ParkReason::Gap));
    h.append();
    h.done(h.storage_id());
    assert_eq!(h.core.push.as_ref().unwrap().rows, [WalSeq(2)]);
    let push = h.core.push.as_ref().unwrap().id.clone();
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&parent),
    });
    assert_eq!(h.core.wal.entries[0].park, Some(ParkReason::Gap));
    assert_eq!(h.core.push.as_ref().unwrap().id, push);
    assert_eq!(h.core.push.as_ref().unwrap().rows, [WalSeq(2)]);
    h.ack();
    assert_eq!(h.core.wal.entries[0].park, None);
    assert_eq!(h.core.push.as_ref().unwrap().rows, [WalSeq(1)]);
    assert!(!h.core.is_delivered(WalSeq(1)));
    h.ack();
    assert!(h.core.is_delivered(WalSeq(1)));
    assert!(h.core.is_delivered(WalSeq(2)));
}
