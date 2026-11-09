use super::*;
use loro::{ContainerTrait, LoroMap, LoroText};

#[test]
fn visible_ids_are_actual_node_and_unicode_character_ids_without_observer_mutation() {
    let doc = LoroDoc::new();
    doc.set_peer_id(31).unwrap();
    doc.set_record_timestamp(false);
    let root = doc.get_map("root");
    let node = root.insert_container("node", LoroMap::new()).unwrap();
    node.insert("type", "text").unwrap();
    let text = node.insert_container("text", LoroText::new()).unwrap();
    text.insert(0, "a🦀").unwrap();
    doc.commit();
    let first = text
        .get_cursor(0, loro::cursor::Side::Middle)
        .unwrap()
        .id
        .unwrap();
    let second = text
        .get_cursor(1, loro::cursor::Side::Middle)
        .unwrap()
        .id
        .unwrap();
    let ContainerID::Normal { peer, counter, .. } = node.id() else {
        panic!("normal node")
    };
    let expected = BTreeSet::from([ID { peer, counter }, first, second]);
    let vv = doc.oplog_vv();
    let value = doc.get_deep_value();
    let before = visible_ids(&doc).unwrap();
    assert_eq!(before, expected);
    assert_eq!(doc.oplog_vv(), vv);
    assert_eq!(doc.get_deep_value(), value);
    text.delete(0, 1).unwrap();
    let after = visible_ids(&doc).unwrap();
    assert_eq!(
        before.difference(&after).copied().collect::<Vec<_>>(),
        vec![first]
    );
    root.delete("node").unwrap();
    assert!(visible_ids(&doc).unwrap().is_empty());
}
