use super::*;
use crate::WallDuration;
use sync_protocol::presence::{EphemeralStore, decode_timestamps};

#[test]
fn shared_wire_bytes_preserve_values_and_sender_times() {
    let shared = EphemeralStore::new(1_000);
    let mut adapter = ProtocolPresence::new(WallDuration(1_000));
    shared.set("remote", 42, UnixMillis(100));
    adapter
        .apply(&shared.encode_all(UnixMillis(100)), UnixMillis(150))
        .unwrap();
    assert_eq!(adapter.peers("")[0].value, loro::LoroValue::from(42));
    assert_eq!(
        adapter.encode("remote", UnixMillis(150)).unwrap(),
        shared.encode("remote", UnixMillis(150))
    );
    adapter.set("local", 7.into(), UnixMillis(200)).unwrap();
    shared
        .apply(
            &adapter.encode("local", UnixMillis(200)).unwrap(),
            UnixMillis(220),
        )
        .unwrap();
    assert_eq!(shared.get("local"), Some(7.into()));
    assert_eq!(
        decode_timestamps(&adapter.encode_all(UnixMillis(220)).unwrap()).unwrap(),
        decode_timestamps(&shared.encode_all(UnixMillis(220))).unwrap()
    );
    assert_eq!(adapter.next_expiry(), Some(UnixMillis(1_101)));
}

#[test]
fn clear_is_null_and_remote_views_exclude_self_and_order_keys() {
    let mut adapter = ProtocolPresence::new(WallDuration(1_000));
    adapter.set("z", 1.into(), UnixMillis(100)).unwrap();
    adapter.set("self", 2.into(), UnixMillis(100)).unwrap();
    adapter.set("a", 3.into(), UnixMillis(100)).unwrap();
    adapter
        .set("clear", loro::LoroValue::Null, UnixMillis(100))
        .unwrap();
    let peers = adapter.peers("self");
    assert_eq!(
        peers.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(),
        ["a", "z"]
    );
    let cleared = decode_timestamps(&adapter.encode("clear", UnixMillis(100)).unwrap()).unwrap();
    assert_eq!(
        cleared["clear"],
        (Some(loro::LoroValue::Null), UnixMillis(100))
    );
}

#[test]
fn duplicate_and_stale_imports_do_not_extend_expiry() {
    let source = EphemeralStore::new(1_000);
    source.set("remote", 1, UnixMillis(100));
    let first = source.encode_all(UnixMillis(100));
    source.set("remote", 2, UnixMillis(200));
    let second = source.encode_all(UnixMillis(200));
    let mut adapter = ProtocolPresence::new(WallDuration(1_000));
    adapter.apply(&second, UnixMillis(300)).unwrap();
    adapter.apply(&first, UnixMillis(400)).unwrap();
    adapter.apply(&second, UnixMillis(500)).unwrap();
    assert_eq!(adapter.peers("")[0].value, loro::LoroValue::from(2));
    assert_eq!(adapter.next_expiry(), Some(UnixMillis(1_201)));
    assert!(!adapter.remove_outdated(UnixMillis(1_200)));
    assert!(adapter.remove_outdated(UnixMillis(1_201)));
    assert!(adapter.peers("").is_empty());
    assert_eq!(adapter.next_expiry(), None);
    adapter.apply(&first, UnixMillis(1_201)).unwrap();
    assert!(adapter.peers("").is_empty());
}

#[test]
fn invalid_payload_does_not_mutate_accepted_presence() {
    let mut adapter = ProtocolPresence::new(WallDuration(1_000));
    adapter.set("remote", 1.into(), UnixMillis(100)).unwrap();
    let before = adapter.peers("");
    assert!(adapter.apply(&[255], UnixMillis(200)).is_err());
    assert_eq!(adapter.peers(""), before);
    assert_eq!(adapter.next_expiry(), Some(UnixMillis(1_101)));
}

#[test]
fn past_due_entries_keep_a_wakeup_when_an_import_is_ignored() {
    let source = EphemeralStore::new(1_000);
    source.set("expired", 2, UnixMillis(0));
    let stale = source.encode_all(UnixMillis(0));
    let mut adapter = ProtocolPresence::new(WallDuration(1_000));
    adapter.set("remote", 1.into(), UnixMillis(100)).unwrap();
    adapter.apply(&stale, UnixMillis(1_200)).unwrap();
    assert_eq!(adapter.next_expiry(), Some(UnixMillis(1_101)));
    assert!(adapter.remove_outdated(UnixMillis(1_200)));
    assert_eq!(adapter.next_expiry(), None);
}
