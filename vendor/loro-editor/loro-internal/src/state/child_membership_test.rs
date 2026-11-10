use super::*;
use crate::{loro::ExportMode, HandlerTrait, ListHandler, LoroDoc, MapHandler};
use rand::{rngs::StdRng, Rng, SeedableRng};

// Compare membership with the actual parent values, independently of its child index.
fn assert_ordinary_membership(doc: &LoroDoc, parents: &[ContainerID]) {
    // Use the normal read path: snapshot-imported roots are registered lazily.
    for parent in parents {
        assert!(doc.get_handler(parent.clone()).is_some());
    }
    let mut state = doc.state.lock();
    let mut ids = state.arena.export_containers();
    for parent in parents {
        let idx = state.arena.id_to_idx(parent).unwrap();
        let value = state.store.get_container_mut(idx).unwrap().get_value();
        let children: Vec<_> = match &value {
            LoroValue::Map(map) => map.values().filter_map(LoroValue::as_container).collect(),
            LoroValue::List(list) => list.iter().filter_map(LoroValue::as_container).collect(),
            _ => panic!("map or list parent"),
        };
        ids.extend(children.iter().map(|id| (*id).clone()));
        for id in &ids {
            if id.is_root() {
                continue;
            }
            let expected = children.contains(&id);
            assert_eq!(
                state.contains_logical_child(idx, id),
                expected,
                "{parent:?} -> {id:?}"
            );
            assert_eq!(state.get_logical_child_index(idx, id).is_some(), expected);
        }
    }
}

#[test]
fn logical_child_membership_matches_values_after_edits_import_and_checkout() {
    for seed in 0..32 {
        let mut rng = StdRng::seed_from_u64(seed);
        let doc = LoroDoc::new_auto_commit();
        doc.set_peer_id(1).unwrap();
        let map = doc.get_map("map");
        let list = doc.get_list("list");
        let movable = doc.get_movable_list("movable");
        // Materialize every root before snapshot/import and before any saved
        // frontier; an untouched root need not be present on a fresh receiver.
        map.insert("initial", 0).unwrap();
        list.insert(0, 0).unwrap();
        movable.insert(0, 0).unwrap();
        doc.commit_then_renew();
        let parents = [map.id(), list.id(), movable.id()];
        let mut frontiers = Vec::new();
        for step in 0..128 {
            let key = format!("k{}", rng.gen_range(0..8));
            match rng.gen_range(0..9) {
                0 => {
                    map.insert_container(&key, MapHandler::new_detached())
                        .unwrap();
                }
                1 => {
                    map.insert(&key, step).unwrap();
                }
                2 => {
                    map.delete(&key).unwrap();
                }
                3 => {
                    list.insert_container(
                        rng.gen_range(0..=list.len()),
                        ListHandler::new_detached(),
                    )
                    .unwrap();
                }
                4 if list.len() > 0 => {
                    list.delete(rng.gen_range(0..list.len()), 1).unwrap();
                }
                5 => {
                    movable
                        .insert_container(
                            rng.gen_range(0..=movable.len()),
                            MapHandler::new_detached(),
                        )
                        .unwrap();
                }
                6 if movable.len() > 0 => {
                    movable.set(rng.gen_range(0..movable.len()), step).unwrap();
                }
                7 if movable.len() > 0 => {
                    movable.delete(rng.gen_range(0..movable.len()), 1).unwrap();
                }
                8 if movable.len() > 1 => {
                    movable
                        .mov(
                            rng.gen_range(0..movable.len()),
                            rng.gen_range(0..movable.len()),
                        )
                        .unwrap();
                }
                _ => {}
            }
            doc.commit_then_renew();
            assert_ordinary_membership(&doc, &parents);
            if step % 16 == 0 {
                frontiers.push(doc.oplog_frontiers());
            }
            if step % 32 == 31 {
                let receiver = LoroDoc::new_auto_commit();
                receiver
                    .import(&doc.export(ExportMode::Snapshot).unwrap())
                    .unwrap();
                assert_ordinary_membership(&receiver, &parents);
                doc.checkout(&frontiers[rng.gen_range(0..frontiers.len())])
                    .unwrap();
                assert_ordinary_membership(&doc, &parents);
                doc.checkout_to_latest();
                assert_ordinary_membership(&doc, &parents);
            }
        }
    }
}

#[test]
fn logical_child_membership_keeps_concurrently_revived_movable_children() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let list = doc.get_movable_list("list");
    let child = list
        .insert_container(0, MapHandler::new_detached())
        .unwrap();
    for i in 0..96 {
        list.insert(i + 1, i as i32).unwrap();
    }
    doc.commit_then_renew();
    let peer = doc.fork();
    peer.set_peer_id(2).unwrap();
    peer.get_map("pad").insert("k", 1).unwrap();
    peer.commit_then_renew();
    peer.get_movable_list("list").mov(0, 96).unwrap();
    peer.commit_then_renew();
    list.delete(0, 1).unwrap();
    doc.commit_then_renew();
    assert!(child.is_deleted());
    assert_ordinary_membership(&doc, &[list.id()]);
    doc.import(&peer.export(ExportMode::all_updates()).unwrap())
        .unwrap();
    assert!(!child.is_deleted());
    assert_ordinary_membership(&doc, &[list.id()]);
    list.set(96, 42).unwrap();
    assert!(child.is_deleted());
    assert_ordinary_membership(&doc, &[list.id()]);
}

#[test]
fn logical_child_membership_retains_mergeable_marker_validation() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let root = doc.get_map("root");
    let wrong = doc.get_map("wrong");
    let child = root.ensure_mergeable_map("child").unwrap();
    let nested = child
        .insert_container("nested", MapHandler::new_detached())
        .unwrap();
    doc.commit_then_renew();
    let check = |live: bool| {
        let mut state = doc.state.lock();
        let parent = state.arena.id_to_idx(&root.id()).unwrap();
        let other = state.arena.id_to_idx(&wrong.id()).unwrap();
        assert_eq!(state.contains_logical_child(parent, &child.id()), live);
        assert_eq!(
            state.get_logical_child_index(parent, &child.id()).is_some(),
            live
        );
        assert!(!state.contains_logical_child(other, &child.id()));
        drop(state);
        assert_eq!(nested.is_deleted(), !live);
    };
    check(true);
    root.delete("child").unwrap();
    check(false);
    root.ensure_mergeable_map("child").unwrap();
    check(true);
    let peer = doc.fork();
    peer.set_peer_id(2).unwrap();
    peer.get_map("root").delete("child").unwrap();
    peer.commit_then_renew();
    doc.import(&peer.export(ExportMode::all_updates()).unwrap())
        .unwrap();
    check(false);
    peer.get_map("root").ensure_mergeable_map("child").unwrap();
    peer.commit_then_renew();
    doc.import(&peer.export(ExportMode::all_updates()).unwrap())
        .unwrap();
    check(true);
}

#[test]
fn logical_child_membership_survives_list_size_transitions() {
    let doc = LoroDoc::new_auto_commit();
    let list = doc.get_list("list");
    for i in 0..96 {
        list.insert_container(i, MapHandler::new_detached())
            .unwrap();
    }
    assert_ordinary_membership(&doc, &[list.id()]);
    list.delete(3, 93).unwrap();
    assert_eq!(list.len(), 3);
    assert_ordinary_membership(&doc, &[list.id()]);
    for i in 0..96 {
        list.insert_container(i, MapHandler::new_detached())
            .unwrap();
    }
    assert_ordinary_membership(&doc, &[list.id()]);
    list.delete(0, list.len()).unwrap();
    assert_ordinary_membership(&doc, &[list.id()]);
}

#[test]
fn logical_child_membership_keeps_tree_metadata_revival() {
    use super::TreeParentId;
    let doc = LoroDoc::new_auto_commit();
    let tree = doc.get_tree("tree");
    let parent = tree.create(TreeParentId::Root).unwrap();
    let child = tree.create(TreeParentId::Node(parent)).unwrap();
    let meta = tree.get_meta(child).unwrap();
    doc.commit_then_renew();
    let check = |live: bool| {
        let mut state = doc.state.lock();
        let idx = state.arena.id_to_idx(&tree.id()).unwrap();
        assert_eq!(state.contains_logical_child(idx, &meta.id()), live);
        assert_eq!(
            state.get_logical_child_index(idx, &meta.id()).is_some(),
            live
        );
        drop(state);
        assert_eq!(meta.is_deleted(), !live);
    };
    check(true);
    tree.delete(parent).unwrap();
    doc.commit_then_renew();
    check(false);
    tree.mov(child, TreeParentId::Root).unwrap();
    doc.commit_then_renew();
    check(true);
}
