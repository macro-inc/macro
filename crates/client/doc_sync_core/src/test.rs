use super::*;

#[test]
fn storage_ops_preserve_all_fields_in_postcard() {
    let doc: sync_doc_id::SyncDocId = "surface:example".parse().unwrap();
    let owner = SessionId(uuid_value::Uuid::from_u128(1));
    let seq = WalSeq(17);
    let user = UserKey("user-example".to_owned());
    let record = WalRecord {
        seq,
        created_at: UnixMillis(-100),
        user: user.clone(),
        foreign: true,
        quarantined: true,
        bytes: vec![0, 1, 255],
    };
    let operations = vec![
        StorageOp::Load {
            doc: doc.clone(),
            owner,
            user: user.clone(),
        },
        StorageOp::LoadOrphans {
            doc: doc.clone(),
            owner,
            user,
        },
        StorageOp::WalAppend {
            doc: doc.clone(),
            owner,
            record,
            retry: true,
        },
        StorageOp::WalMarkDelivered {
            doc: doc.clone(),
            owner,
            through: seq,
        },
        StorageOp::WalPrune {
            doc: doc.clone(),
            owner,
            through: seq,
        },
        StorageOp::WalAdopt {
            doc: doc.clone(),
            from: WalOwner::Legacy,
            to: owner,
            first_seq: seq,
            covers: WalSeq(3),
            expected: Vec::new(),
        },
        StorageOp::WalAdopt {
            doc: doc.clone(),
            from: WalOwner::Session(owner),
            to: owner,
            first_seq: seq,
            covers: WalSeq(0),
            expected: Vec::new(),
        },
        StorageOp::WalDropExpired {
            doc: doc.clone(),
            from: WalOwner::Legacy,
            before: UnixMillis(-1),
        },
        StorageOp::WalQuarantine {
            doc: doc.clone(),
            owner,
            seq,
        },
        StorageOp::SnapshotSave {
            doc: doc.clone(),
            bytes: vec![255, 0],
            covers: Some((owner, seq)),
        },
        StorageOp::SnapshotSave {
            doc: doc.clone(),
            bytes: vec![],
            covers: None,
        },
        StorageOp::SnapshotDelete { doc },
    ];
    for op in operations {
        let encoded = postcard::to_stdvec(&op).unwrap();
        assert_eq!(postcard::from_bytes::<StorageOp>(&encoded).unwrap(), op);
        assert!(postcard::from_bytes::<StorageOp>(&encoded[..encoded.len() - 1]).is_err());
    }
}

#[test]
fn tokens_are_redacted_and_update_ids_are_deterministic() {
    let token = SyncToken::new("test-only-token".to_owned());
    assert_eq!(format!("{token:?}"), "SyncToken(<redacted>)");
    assert_eq!(token.expose_secret(), "test-only-token");
    let session = SessionId(uuid_value::Uuid::from_u128(1));
    assert_eq!(
        UpdateId::new(session, 42).as_str(),
        "00000000-0000-0000-0000-000000000001:42"
    );
    let output = SyncOutput::default();
    assert!(output.io.is_empty());
    assert!(output.events.is_empty());
    assert_eq!(output.wake_at, None);
}
