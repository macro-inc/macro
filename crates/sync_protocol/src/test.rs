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
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/peer-update.bin")
                .as_slice(),
        ),
        (
            FromPeer::PeerCommentUpdate {
                updates: vec![SliceWrapper::from_cooked(&[0, 1, 255])],
                id: "op",
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/peer-comment-update.bin")
                .as_slice(),
        ),
        (
            FromPeer::PeerAwareness {
                awareness: SliceWrapper::from_cooked(&[3, 4]),
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/peer-awareness.bin")
                .as_slice(),
        ),
        (
            FromPeer::PeerRequestSince {
                vv: SliceWrapper::from_cooked(&[5, 6]),
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/peer-since.bin")
                .as_slice(),
        ),
        (
            FromPeer::PeerRequestSnapshot {},
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/peer-snapshot.bin")
                .as_slice(),
        ),
        (
            FromPeer::PeerRegisterId {
                peerid: 0x0102030405060708,
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/peer-register.bin")
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
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/remote-initial.bin")
                .as_slice(),
        ),
        (
            FromRemote::RemoteUpdate {
                update: SliceWrapper::from_cooked(&[0, 1, 255]),
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/remote-update.bin")
                .as_slice(),
        ),
        (
            FromRemote::RemoteAwareness {
                awareness: SliceWrapper::from_cooked(&[3, 4]),
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/remote-awareness.bin")
                .as_slice(),
        ),
        (
            FromRemote::RemoteSnapshot {
                snapshot: SliceWrapper::from_cooked(&[1, 2]),
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/remote-snapshot.bin")
                .as_slice(),
        ),
        (
            FromRemote::RemoteUpdateAck { id: "op" },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/remote-ack.bin")
                .as_slice(),
        ),
        (
            FromRemote::RemoteUpdateSince {
                update: SliceWrapper::from_cooked(&[0, 1, 255]),
                vv: SliceWrapper::from_cooked(&[5, 6]),
            },
            include_bytes!("../../sync_server_sim/tests/transcripts/codec/remote-since.bin")
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
        .join("../sync_server_sim/tests/transcripts");
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
            assert!(
                path.ends_with(".jsonl") || path.ends_with(".jsonl.gz"),
                "{id} must link to a recording"
            );
            let transcript = read_inventory_transcript(&root.join(path))
                .unwrap_or_else(|error| panic!("invalid {id} transcript {path}: {error}"));
            assert!(transcript.contains("\"in\":"), "{id} has no input");
            assert!(transcript.contains("\"out\":"), "{id} has no output");
        }
    }
}

fn read_inventory_transcript(path: &std::path::Path) -> std::io::Result<String> {
    if path.extension().is_some_and(|extension| extension == "gz") {
        use std::io::Read;
        let mut text = String::new();
        flate2::read::MultiGzDecoder::new(std::fs::File::open(path)?).read_to_string(&mut text)?;
        Ok(text)
    } else {
        std::fs::read_to_string(path)
    }
}

#[test]
fn inventory_gzip_reads_all_members_and_rejects_trailing_corruption() {
    use std::io::Write;
    let path = std::env::temp_dir().join(format!(
        "sync-inventory-gzip-{}.jsonl.gz",
        std::process::id()
    ));
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .unwrap();
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            std::fs::remove_file(&self.0).unwrap();
        }
    }
    let _cleanup = Cleanup(path.clone());
    let mut bytes = Vec::new();
    for text in ["first\n", "second\n"] {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        encoder.write_all(text.as_bytes()).unwrap();
        bytes.extend(encoder.finish().unwrap());
    }
    file.write_all(&bytes).unwrap();
    drop(file);
    assert_eq!(read_inventory_transcript(&path).unwrap(), "first\nsecond\n");
    bytes.push(1);
    std::fs::write(&path, bytes).unwrap();
    assert!(read_inventory_transcript(&path).is_err());
}
