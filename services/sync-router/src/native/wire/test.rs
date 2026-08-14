use super::*;
use sync_service_bebop_schema::FromPeer;

fn roundtrip_peer(frame: &FromPeer<'_>) -> ClientFrame {
    let mut bytes = Vec::new();
    frame.serialize(&mut bytes).unwrap();
    decode_from_peer(&bytes).expect("frame should decode")
}

#[test]
fn decodes_every_peer_variant() {
    assert_eq!(
        roundtrip_peer(&FromPeer::PeerUpdate {
            updates: vec![SliceWrapper::Raw(b"u1"), SliceWrapper::Raw(b"u2")],
            id: "batch-1",
        }),
        ClientFrame::Update {
            updates: vec![b"u1".to_vec(), b"u2".to_vec()],
            id: "batch-1".to_string(),
        }
    );
    assert_eq!(
        roundtrip_peer(&FromPeer::PeerAwareness {
            awareness: SliceWrapper::Raw(b"presence"),
        }),
        ClientFrame::Presence {
            payload: b"presence".to_vec(),
        }
    );
    assert_eq!(
        roundtrip_peer(&FromPeer::PeerRequestSince {
            vv: SliceWrapper::Raw(b"cursor"),
        }),
        ClientFrame::RequestSince {
            cursor: b"cursor".to_vec(),
        }
    );
    assert_eq!(
        roundtrip_peer(&FromPeer::PeerRequestSnapshot {}),
        ClientFrame::RequestSnapshot
    );
    assert_eq!(
        roundtrip_peer(&FromPeer::PeerRegisterId { peerid: 42 }),
        ClientFrame::RegisterPeer { peer_id: 42 }
    );
}

#[test]
fn garbage_decodes_to_none() {
    assert_eq!(decode_from_peer(b"not a bebop frame"), None);
}

#[test]
fn overlong_declared_length_decodes_to_none() {
    // A known discriminator whose body is shorter than the declared length:
    // bebop's generated deserializer panics on this in debug builds, which
    // used to take the route's pump task down with it.
    let mut bytes = 64u32.to_le_bytes().to_vec();
    bytes.push(4); // PeerRequestSnapshot: consumes no body
    assert_eq!(decode_from_peer(&bytes), None);
}

#[test]
fn encodes_every_remote_variant() {
    let cases = [
        ServerFrame::InitialSync {
            snapshot: b"snap".to_vec(),
            presence: b"pres".to_vec(),
        },
        ServerFrame::Update {
            update: b"up".to_vec(),
        },
        ServerFrame::Presence {
            payload: b"aw".to_vec(),
        },
        ServerFrame::Snapshot {
            snapshot: b"snap2".to_vec(),
        },
        ServerFrame::Ack {
            id: "batch-1".to_string(),
        },
        ServerFrame::Since {
            update: b"diff".to_vec(),
            cursor: b"cursor".to_vec(),
        },
    ];
    for case in &cases {
        let bytes = encode_from_remote(case);
        let decoded = owned::FromRemote::deserialize(&bytes).unwrap();
        match (case, decoded) {
            (
                ServerFrame::InitialSync { snapshot, presence },
                owned::FromRemote::RemoteInitialSync {
                    snapshot: s,
                    awareness: a,
                },
            ) => {
                assert_eq!(&s, snapshot);
                assert_eq!(&a, presence);
            }
            (ServerFrame::Update { update }, owned::FromRemote::RemoteUpdate { update: u }) => {
                assert_eq!(&u, update);
            }
            (
                ServerFrame::Presence { payload },
                owned::FromRemote::RemoteAwareness { awareness },
            ) => {
                assert_eq!(&awareness, payload);
            }
            (
                ServerFrame::Snapshot { snapshot },
                owned::FromRemote::RemoteSnapshot { snapshot: s },
            ) => {
                assert_eq!(&s, snapshot);
            }
            (ServerFrame::Ack { id }, owned::FromRemote::RemoteUpdateAck { id: i }) => {
                assert_eq!(&i, id);
            }
            (
                ServerFrame::Since { update, cursor },
                owned::FromRemote::RemoteUpdateSince { update: u, vv },
            ) => {
                assert_eq!(&u, update);
                assert_eq!(&vv, cursor);
            }
            (case, decoded) => panic!("mismatched mapping: {case:?} -> {decoded:?}"),
        }
    }
}
