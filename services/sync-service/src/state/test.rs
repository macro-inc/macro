use super::*;
use automerge::{ObjType, transaction::Transactable};

fn put(doc: &mut Automerge, key: &str, value: &str) {
    let mut tx = doc.transaction();
    tx.put(ROOT, key, value).unwrap();
    tx.commit();
}

#[test]
fn concurrent_branches_survive_snapshot_reconnect_and_historical_copy() {
    for branches in 1..=9 {
        let mut seed = Automerge::new();
        put(&mut seed, "title", "common ancestor");
        let original = seed.get_heads();
        let state = DocumentState::try_from_snapshot(&seed.save()).unwrap();
        for peer in 1..=branches {
            let mut branch = seed.fork();
            put(&mut branch, &peer.to_string(), "concurrent");
            state.import(&branch.save_after(&original)).unwrap();
        }
        assert_eq!(state.heads().len(), branches);
        let snapshot = state.export_shallow_snapshot().unwrap();
        let restored = DocumentState::try_from_snapshot(&snapshot).unwrap();
        assert_eq!(restored.heads(), state.heads());
        assert_eq!(restored.get_json(), state.get_json());
        let historical =
            Automerge::load(&state.export_snapshot(Some(original.clone())).unwrap()).unwrap();
        assert_eq!(historical.get_heads(), original);
        let mut client = Automerge::load(&snapshot).unwrap();
        put(&mut client, "after-reconnect", "saved");
        assert!(
            state
                .import(&client.save_after(&restored.heads()))
                .unwrap()
                .changed
        );
        assert!(
            !state
                .import(&client.save_after(&restored.heads()))
                .unwrap()
                .changed
        );
        assert!(state.should_save());
        state.mark_exported();
        assert!(!state.should_save());
    }
}

#[test]
fn replay_is_atomic_and_accepts_noncausal_log_order() {
    let mut doc = Automerge::new();
    put(&mut doc, "content", "seed");
    let state = DocumentState::try_from_snapshot(&doc.save()).unwrap();
    put(&mut doc, "first", "one");
    let first = doc.save_after(&state.heads());
    let before = doc.get_heads();
    put(&mut doc, "second", "two");
    let second = doc.save_after(&before);
    assert!(state.import(&second).is_err());
    assert_eq!(state.heads().len(), 1);
    state
        .replay_pending_operations(&[second.clone(), first.clone(), second])
        .unwrap();
    assert_eq!(state.heads(), doc.get_heads());
    let heads = state.heads();
    assert!(
        state
            .replay_pending_operations(&[first, vec![0xff]])
            .is_err()
    );
    assert_eq!(state.heads(), heads);
}

#[test]
fn touched_nodes_include_nearest_lexical_ancestor() {
    let mut doc = Automerge::new();
    let mut tx = doc.transaction();
    let root = tx.put_object(ROOT, "root", ObjType::Map).unwrap();
    let meta = tx.put_object(&root, "$", ObjType::Map).unwrap();
    tx.put(meta, "id", "node-id").unwrap();
    let text = tx.put_object(root, "text", ObjType::Text).unwrap();
    tx.splice_text(&text, 0, 0, "initial").unwrap();
    tx.commit();
    let state = DocumentState::try_from_snapshot(&doc.save()).unwrap();
    let mut tx = doc.transaction();
    tx.splice_text(text, 0, 0, "edited ").unwrap();
    tx.commit();
    let imported = state.import(&doc.save_after(&state.heads())).unwrap();
    assert_eq!(imported.touched_nodes, ["node-id"]);
}

#[test]
fn large_text_batches_survive_roundtrip() {
    let mut client = Automerge::new();
    let mut tx = client.transaction();
    let text = tx.put_object(ROOT, "content", ObjType::Text).unwrap();
    tx.commit();
    let server = DocumentState::try_from_snapshot(&client.save()).unwrap();
    let mut length = 0;
    let mut updates = Vec::new();
    for _ in 0..5 {
        let before = client.get_heads();
        let mut tx = client.transaction();
        tx.splice_text(&text, length, 0, &"x".repeat(40_000))
            .unwrap();
        tx.commit();
        updates.push(client.save_after(&before));
        length += 40_000;
    }
    server
        .import_batch(&updates.iter().map(Vec::as_slice).collect::<Vec<_>>())
        .unwrap();
    let snapshot = server.export_snapshot(None).unwrap();
    let restored = Automerge::load(&snapshot).unwrap();
    assert_eq!(restored.text(text).unwrap().len(), 200_000);
}
