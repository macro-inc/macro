use super::*;

#[test]
fn rejects_stale_presence_and_expires_tombstones() {
    let store = PresenceStore::new(5_000);
    store
        .apply(br#"{"1":{"clock":2,"value":{"cursor":"position"}}}"#)
        .unwrap();
    store.delete("1");
    store
        .apply(br#"{"1":{"clock":1,"value":"stale"}}"#)
        .unwrap();
    let state: serde_json::Value = serde_json::from_slice(&store.encode_all()).unwrap();
    assert!(state["1"]["value"].is_null());
    store
        .apply(br#"{"1":{"clock":3,"value":"fresh"}}"#)
        .unwrap();
    let state: serde_json::Value = serde_json::from_slice(&store.encode_all()).unwrap();
    assert_eq!(state["1"]["value"], "fresh");
}

#[test]
fn expired_sessions_do_not_exhaust_presence_capacity() {
    let store = PresenceStore::new(5_000);
    for peer in 0..1024 {
        store
            .apply(format!(r#"{{"{peer}":{{"clock":1,"value":true}}}}"#).as_bytes())
            .unwrap();
    }
    for entry in store.entries.lock().unwrap().values_mut() {
        entry.received = Instant::now() - std::time::Duration::from_secs(6);
    }
    store
        .apply(br#"{"1024":{"clock":1,"value":true}}"#)
        .unwrap();
    assert_eq!(store.entries.lock().unwrap().len(), 1);
    assert!(
        store
            .apply(br#"{"invalid":{"clock":1,"value":true}}"#)
            .is_err()
    );
}
