use super::*;

/// Round-trip through the real CRDT: edit on a "client" doc, ship the update
/// through the replica, snapshot, reload, diff.
#[test]
fn apply_snapshot_reload_and_diff_round_trip() {
    // A client-side doc makes an edit.
    let client = LoroDoc::new();
    client.get_text("content").push_str("hello").unwrap();
    let update = client.export(ExportMode::Snapshot).unwrap();

    // The replica applies it.
    let mut replica = LoroReplica::empty();
    replica.apply(&update).unwrap();

    // Snapshot → reload gives back the same content.
    let snapshot = replica.snapshot();
    let reloaded = LoroReplica::load(&snapshot).unwrap();
    assert_eq!(reloaded.doc.get_text("content").to_string(), "hello");

    // A peer at nothing gets everything.
    let from_zero = reloaded.diff_since(&VersionVector::new().encode()).unwrap();
    let catch_up = LoroDoc::new();
    catch_up.import(from_zero.as_slice()).unwrap();
    assert_eq!(catch_up.get_text("content").to_string(), "hello");
}

#[test]
fn garbage_update_is_an_error_not_a_panic() {
    let mut replica = LoroReplica::empty();
    assert!(replica.apply(&[0xde, 0xad, 0xbe, 0xef]).is_err());
}

#[test]
fn presence_merges_and_removals_encode() {
    use loro::awareness::EphemeralStore;

    // A client publishes presence under its peer id.
    let client = EphemeralStore::new(60_000);
    client.set("7", "cursor@3");
    let payload = client.encode_all();

    let mut replica = LoroReplica::empty();
    replica.apply_presence(&payload);
    assert!(!replica.presence_all().as_slice().is_empty());

    let removal = replica.remove_presence(&[7]).expect("removal delta");
    // The delta must be applicable by another client.
    let other = EphemeralStore::new(60_000);
    other.apply(removal.as_slice()).unwrap();
}

#[test]
fn corrupt_snapshot_fails_to_load() {
    assert!(LoroReplica::load(&[1, 2, 3]).is_err());
}
