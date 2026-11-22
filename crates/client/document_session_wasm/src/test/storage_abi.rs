use super::*;

#[test]
fn storage_operations_keep_the_deployed_one_byte_tags_and_full_payload_bytes() {
    let doc = "fixture-document".parse::<SyncDocId>().unwrap();
    let owner = codec::session("00000000-0000-0000-0000-000000000001").unwrap();
    let other = codec::session("00000000-0000-0000-0000-000000000002").unwrap();
    let record = WalRecord {
        seq: WalSeq(9_007_199_254_740_993),
        created_at: UnixMillis(-17),
        user: UserKey("fixture-user".into()),
        foreign: true,
        quarantined: true,
        bytes: vec![0, 255, 1],
    };
    let cases = [
        (
            wire::StorageOpKind::Load,
            StorageOp::Load {
                doc: doc.clone(),
                owner,
                user: UserKey("fixture-user".into()),
            },
        ),
        (
            wire::StorageOpKind::LoadOrphans,
            StorageOp::LoadOrphans {
                doc: doc.clone(),
                owner,
                user: UserKey("fixture-user".into()),
            },
        ),
        (
            wire::StorageOpKind::WalAppend,
            StorageOp::WalAppend {
                doc: doc.clone(),
                owner,
                record: record.clone(),
                retry: true,
            },
        ),
        (
            wire::StorageOpKind::WalMarkDelivered,
            StorageOp::WalMarkDelivered {
                doc: doc.clone(),
                owner,
                through: WalSeq(17),
            },
        ),
        (
            wire::StorageOpKind::WalPrune,
            StorageOp::WalPrune {
                doc: doc.clone(),
                owner,
                through: WalSeq(19),
            },
        ),
        (
            wire::StorageOpKind::WalAdopt,
            StorageOp::WalAdopt {
                doc: doc.clone(),
                from: WalOwner::Legacy,
                to: owner,
                first_seq: WalSeq(11),
                covers: WalSeq(7),
                expected: vec![StoredWalRecord {
                    record,
                    delivered: true,
                }],
            },
        ),
        (
            wire::StorageOpKind::WalDropExpired,
            StorageOp::WalDropExpired {
                doc: doc.clone(),
                from: WalOwner::Session(other),
                before: UnixMillis(-17),
            },
        ),
        (
            wire::StorageOpKind::WalQuarantine,
            StorageOp::WalQuarantine {
                doc: doc.clone(),
                owner,
                seq: WalSeq(23),
            },
        ),
        (
            wire::StorageOpKind::SnapshotSave,
            StorageOp::SnapshotSave {
                doc: doc.clone(),
                bytes: vec![1, 2, 255],
                covers: Some((owner, WalSeq(29))),
            },
        ),
        (
            wire::StorageOpKind::SnapshotDelete,
            StorageOp::SnapshotDelete { doc },
        ),
    ];
    let fixtures: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("fixtures/storage-abi-v2.json")).unwrap();
    assert_eq!(fixtures.len(), cases.len());
    assert_eq!(std::mem::size_of::<wire::StorageOpKind>(), 1);
    assert_eq!(generated::ABI_MAJOR, 2);
    for (tag, ((kind, op), fixture)) in cases.into_iter().zip(fixtures).enumerate() {
        assert_eq!(fixture["name"], format!("{kind:?}"));
        let expected: Vec<u8> = serde_json::from_value(fixture["bytes"].clone()).unwrap();
        assert_eq!(expected[0], u8::try_from(tag).unwrap());
        let encoded = storage::encode(&op, true);
        assert_eq!(encoded.kind, kind);
        assert_eq!(bytes(&encoded).unwrap(), expected);
        assert_eq!(wire::StorageOpMsg::deserialize(&expected).unwrap(), encoded);
        let output = SessionOutput {
            io: vec![IoEffect::Storage {
                id: StorageOpId(7),
                op,
            }],
            ..SessionOutput::default()
        };
        let mut packet = Vec::new();
        output::encode(&output, true, &mut packet, None, None).unwrap();
        // ABI-2 envelope: no diff, one storage entry, unchanged u32 metadata tag.
        let mut expected_packet = Vec::new();
        for word in [
            0x4d53_4553,
            2,
            1,
            0,
            0,
            1,
            6,
            7,
            u32::try_from(tag).unwrap(),
            u32::try_from(expected.len()).unwrap(),
        ] {
            expected_packet.extend(word.to_le_bytes());
        }
        expected_packet.extend(&expected);
        while !expected_packet.len().is_multiple_of(4) {
            expected_packet.push(0);
        }
        assert_eq!(packet, expected_packet);
        for invalid in [10, 255] {
            let mut unknown = expected.clone();
            unknown[0] = invalid;
            assert!(wire::StorageOpMsg::deserialize(&unknown).is_err());
        }
        for length in [0, 1, expected.len() - 1] {
            assert!(wire::StorageOpMsg::deserialize(&expected[..length]).is_err());
        }
    }
}
