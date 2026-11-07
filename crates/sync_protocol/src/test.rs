use super::{FromPeer, FromRemote};
use bebop::{Record, SliceWrapper};

#[test]
fn peer_variants_match_typescript_bytes() {
    let fixtures = [
        (
            FromPeer::PeerUpdate {
                updates: vec![SliceWrapper::from_cooked(&[0, 1, 255])],
                id: "op",
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/peer-update.bin"
            )
            .as_slice(),
        ),
        (
            FromPeer::PeerCommentUpdate {
                updates: vec![SliceWrapper::from_cooked(&[0, 1, 255])],
                id: "op",
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/peer-comment-update.bin"
            )
            .as_slice(),
        ),
        (
            FromPeer::PeerAwareness {
                awareness: SliceWrapper::from_cooked(&[3, 4]),
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/peer-awareness.bin"
            )
            .as_slice(),
        ),
        (
            FromPeer::PeerRequestSince {
                vv: SliceWrapper::from_cooked(&[5, 6]),
            },
            include_bytes!("../../../services/sync-service/tests/transcripts/codec/peer-since.bin")
                .as_slice(),
        ),
        (
            FromPeer::PeerRequestSnapshot {},
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/peer-snapshot.bin"
            )
            .as_slice(),
        ),
        (
            FromPeer::PeerRegisterId {
                peerid: 0x0102030405060708,
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/peer-register.bin"
            )
            .as_slice(),
        ),
    ];
    for (message, expected) in fixtures {
        let mut bytes = Vec::new();
        message.serialize(&mut bytes).unwrap();
        assert_eq!(bytes, expected);
    }
}

#[test]
fn remote_variants_match_typescript_bytes() {
    let fixtures = [
        (
            FromRemote::RemoteInitialSync {
                snapshot: SliceWrapper::from_cooked(&[1, 2]),
                awareness: SliceWrapper::from_cooked(&[3, 4]),
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/remote-initial.bin"
            )
            .as_slice(),
        ),
        (
            FromRemote::RemoteUpdate {
                update: SliceWrapper::from_cooked(&[0, 1, 255]),
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/remote-update.bin"
            )
            .as_slice(),
        ),
        (
            FromRemote::RemoteAwareness {
                awareness: SliceWrapper::from_cooked(&[3, 4]),
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/remote-awareness.bin"
            )
            .as_slice(),
        ),
        (
            FromRemote::RemoteSnapshot {
                snapshot: SliceWrapper::from_cooked(&[1, 2]),
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/remote-snapshot.bin"
            )
            .as_slice(),
        ),
        (
            FromRemote::RemoteUpdateAck { id: "op" },
            include_bytes!("../../../services/sync-service/tests/transcripts/codec/remote-ack.bin")
                .as_slice(),
        ),
        (
            FromRemote::RemoteUpdateSince {
                update: SliceWrapper::from_cooked(&[0, 1, 255]),
                vv: SliceWrapper::from_cooked(&[5, 6]),
            },
            include_bytes!(
                "../../../services/sync-service/tests/transcripts/codec/remote-since.bin"
            )
            .as_slice(),
        ),
    ];
    for (message, expected) in fixtures {
        let mut bytes = Vec::new();
        message.serialize(&mut bytes).unwrap();
        assert_eq!(bytes, expected);
    }
}

#[test]
fn every_inventory_row_has_a_recorded_transcript() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../services/sync-service/tests/transcripts");
    let coverage = std::fs::read_to_string(root.join("COVERAGE.md")).unwrap();
    for (prefix, count) in [
        ('E', 7),
        ('C', 8),
        ('H', 10),
        ('M', 16),
        ('X', 5),
        ('A', 8),
        ('R', 10),
        ('S', 9),
        ('Q', 12),
    ] {
        for number in 1..=count {
            let id = format!("{prefix}{number}");
            let marker = format!("| {id} |");
            let row = coverage
                .lines()
                .find(|line| line.starts_with(&marker))
                .unwrap_or_else(|| panic!("missing coverage row {id}"));
            let (_, link) = row
                .split_once("](")
                .unwrap_or_else(|| panic!("no transcript for {id}"));
            let (path, _) = link.split_once(')').unwrap();
            assert!(path.ends_with(".jsonl"), "{id} must link to a recording");
            let transcript = std::fs::read_to_string(root.join(path))
                .unwrap_or_else(|error| panic!("missing {id} transcript {path}: {error}"));
            assert!(transcript.contains("\"in\":"), "{id} has no input");
            assert!(transcript.contains("\"out\":"), "{id} has no output");
        }
    }
}
