use super::*;

#[test]
fn vendored_store_matches_loro_1_16_2_bytes_with_matching_timestamps() {
    let loro = loro::awareness::EphemeralStore::new(i64::MAX);
    let vendored = EphemeralStore::new(i64::MAX);
    loro.set("cursor", 42);
    let bytes = loro.encode("cursor");
    let now = decode_timestamps(&bytes).expect("Loro wire")["cursor"].1;
    vendored.set("cursor", 42, now);
    assert_eq!(bytes, vendored.encode("cursor", now));
    assert_eq!(loro.encode_all(), vendored.encode_all(now));
    let imported = EphemeralStore::new(i64::MAX);
    let loro_imported = loro::awareness::EphemeralStore::new(i64::MAX);
    imported.apply(&bytes, now).expect("import");
    loro_imported.apply(&bytes).expect("Loro import");
    assert_eq!(loro_imported.encode_all(), imported.encode_all(now));
    // Imports must not replace values at equal timestamps.
    imported.apply(&bytes, now).expect("equal timestamp");
    assert_eq!(loro_imported.get_all_states(), imported.get_all_states());
    loro.delete("cursor");
    let removed = loro.encode("cursor");
    let deleted_at = decode_timestamps(&removed).expect("tombstone")["cursor"].1;
    vendored.delete("cursor", deleted_at);
    assert_eq!(removed, vendored.encode("cursor", deleted_at));
    imported.apply(&removed, deleted_at).expect("delete import");
    loro_imported.apply(&removed).expect("Loro delete import");
    assert_eq!(loro_imported.encode_all(), imported.encode_all(deleted_at));
    imported.remove_outdated(deleted_at);
    loro_imported.remove_outdated();
    assert_eq!(loro_imported.encode_all(), imported.encode_all(deleted_at));
}

#[test]
fn expiration_is_strict_and_tombstones_and_subscriptions_keep_the_injected_clock() {
    let store = EphemeralStore::new(5_000);
    let updates = Arc::new(std::sync::Mutex::new(Vec::new()));
    let capture = updates.clone();
    let _subscription = store.subscribe_local_updates(Box::new(move |bytes| {
        capture.lock().expect("capture").push(bytes.clone());
        true
    }));
    store.set("cursor", 1, UnixMillis(100));
    assert_eq!(
        decode_timestamps(&updates.lock().expect("capture")[0]).expect("local bytes")["cursor"].1,
        UnixMillis(100)
    );
    assert!(!decode_timestamps(&store.encode_all(UnixMillis(5100)))
        .expect("at boundary")
        .is_empty());
    assert!(decode_timestamps(&store.encode_all(UnixMillis(5101)))
        .expect("expired")
        .is_empty());
    store.remove_outdated(UnixMillis(5100));
    assert_eq!(store.get("cursor"), Some(1.into()));
    store.remove_outdated(UnixMillis(5101));
    assert_eq!(store.get("cursor"), None);
    store.delete("cursor", UnixMillis(6000));
    assert_eq!(
        decode_timestamps(&store.encode("cursor", UnixMillis(6000))).expect("tombstone")["cursor"],
        (None, UnixMillis(6000))
    );
}
