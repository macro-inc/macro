use super::*;

#[test]
fn capture_preserves_raw_metadata_and_stable_reference_across_graphs() -> Result<(), BoundaryError>
{
    let value =
        Selection::Range(RangeSelection::at_root()).with_foreign_value_metadata(true, Some(true));
    let identity = ForeignSelectionIdentity::default();
    let mut ledger = SelectionValues::new(7);
    let first = ledger.capture(&value, identity.clone(), 10, Origin::Active { update: 2 })?;
    let (decoded, _, reference) = decode(first)?;
    assert!(decoded.is_dirty());
    assert_eq!(decoded.as_range().unwrap().cached_is_backward(), Some(true));
    let second = ledger.capture(&value, identity, 11, Origin::Frozen)?;
    let (_, _, second_reference) = decode(second)?;
    assert_eq!(reference, second_reference);
    let owned = ledger.get(reference)?;
    assert_eq!(owned.origin, Origin::Frozen);
    assert_eq!(
        owned.value.as_range().unwrap().cached_is_backward(),
        Some(true)
    );
    ledger.retain(reference)?;
    ledger.release_graph(10);
    ledger.release_graph(11);
    assert!(ledger.get(reference).is_ok());
    ledger.release(reference)?;
    assert!(ledger.get(reference).is_err());
    Ok(())
}

#[test]
fn historical_detached_patch_uses_scope_graph_and_preserves_full_node_cache()
-> Result<(), BoundaryError> {
    let mut ledger = SelectionValues::new(7);
    let reference = ledger.allocate(Selection::Range(RangeSelection::at_root()), 3, 1)?;
    ledger.retain(reference)?;
    let cached = compat::ForeignNodeRef {
        editor_id: 7,
        version: 20,
        key: compat::ForeignKey {
            index: 9,
            generation: 2,
        },
        instance_owner_id: 7,
        class_id: 4,
        instance_id: 91,
    };
    let data = compat::CompatSelectionData::CompatRangeSelection {
        reference,
        anchor: compat::CompatPoint {
            key: compat::ForeignKey {
                index: 999,
                generation: 2,
            },
            offset: 40,
            kind: compat::CompatPointKind::Text,
        },
        focus: point(Point::element(NodeKey::ROOT, lexical_model::ChildIndex(0))),
        format: TextFormat::BOLD.bits(),
        style: vec![0x61],
        dirty: true,
        has_cached_backward: true,
        cached_backward: true,
        has_cached_nodes: true,
        cached_nodes: vec![cached],
    };
    let patched = ledger.patch(
        reference,
        data.clone(),
        Scope {
            historical: true,
            state_version: 20,
            update: 2,
            activate: false,
        },
    )?;
    assert_eq!(patched.cached_nodes, Some(vec![cached]));
    assert_eq!(patched.value.as_range().unwrap().anchor.offset(), 40);
    assert_eq!(
        patched.value.as_range().unwrap().cached_is_backward(),
        Some(true)
    );
    assert!(
        ledger
            .patch(
                reference,
                data,
                Scope {
                    historical: true,
                    state_version: 20,
                    update: 2,
                    activate: true
                }
            )
            .is_err()
    );
    ledger.release(reference)?;
    ledger.release_graph(3);
    assert!(ledger.get(reference).is_ok());
    ledger.release_graph(20);
    assert!(ledger.get(reference).is_err());
    Ok(())
}

#[test]
fn failed_patch_is_atomic_and_exact_references_are_required() -> Result<(), BoundaryError> {
    let mut ledger = SelectionValues::new(7);
    let reference = ledger.allocate(Selection::Range(RangeSelection::at_root()), 1, 1)?;
    ledger.retain(reference)?;
    let original = encode(&ledger.get(reference)?);
    let mut data = original.clone();
    if let compat::CompatSelectionData::CompatRangeSelection { style, dirty, .. } = &mut data {
        *style = vec![0xd800];
        *dirty = true;
    }
    assert!(
        ledger
            .patch(
                reference,
                data,
                Scope {
                    historical: false,
                    state_version: 3,
                    update: 1,
                    activate: false
                }
            )
            .is_err()
    );
    assert_eq!(encode(&ledger.get(reference)?), original);
    let mut wrong = reference;
    wrong.version = 3;
    assert!(ledger.get(wrong).is_err());
    assert!(ledger.retain(wrong).is_err());
    assert!(ledger.release(wrong).is_err());
    wrong = reference;
    wrong.editor_id = 8;
    assert!(ledger.get(wrong).is_err());
    wrong = reference;
    wrong.selection_id = 0;
    assert!(ledger.get(wrong).is_err());
    assert!(
        ledger
            .patch(
                reference,
                compat::CompatSelectionData::Unknown,
                Scope {
                    historical: false,
                    state_version: 3,
                    update: 1,
                    activate: false
                }
            )
            .is_err()
    );
    assert_eq!(encode(&ledger.get(reference)?), original);
    ledger.release(reference)?;
    ledger.release_graph(1);
    assert!(ledger.get(reference).is_err());
    Ok(())
}

#[test]
fn active_values_freeze_on_publish_and_survive_discard_as_detached() -> Result<(), BoundaryError> {
    let mut ledger = SelectionValues::new(7);
    let value = Selection::Range(RangeSelection::at_root());
    let frozen = ledger.capture(
        &value,
        ForeignSelectionIdentity::default(),
        1,
        Origin::Active { update: 4 },
    )?;
    let (_, _, frozen_ref) = decode(frozen.clone())?;
    let discarded = ledger.capture(
        &value,
        ForeignSelectionIdentity::default(),
        2,
        Origin::Active { update: 5 },
    )?;
    let (_, _, discarded_ref) = decode(discarded.clone())?;
    assert!(
        ledger
            .patch(
                frozen_ref,
                frozen.clone(),
                Scope {
                    historical: false,
                    state_version: 1,
                    update: 3,
                    activate: false
                }
            )
            .is_err()
    );
    ledger.finish_update(4, true);
    assert!(
        ledger
            .patch(
                frozen_ref,
                frozen,
                Scope {
                    historical: false,
                    state_version: 1,
                    update: 4,
                    activate: false
                }
            )
            .is_err()
    );
    ledger.retain(discarded_ref)?;
    ledger.finish_update(5, false);
    ledger.release_graph(2);
    assert_eq!(
        ledger.get(discarded_ref)?.origin,
        Origin::Detached { update: 5 }
    );
    ledger.patch(
        discarded_ref,
        discarded,
        Scope {
            historical: true,
            state_version: 9,
            update: 8,
            activate: false,
        },
    )?;
    ledger.release(discarded_ref)?;
    ledger.release_graph(9);
    assert!(ledger.get(discarded_ref).is_err());
    assert!(ledger.release(discarded_ref).is_err());
    Ok(())
}

#[test]
fn table_and_node_values_roundtrip_without_graph_queries() -> Result<(), BoundaryError> {
    let mut ledger = SelectionValues::new(7);
    let table_key = NodeKey::from_parts(KeyParts {
        index: 50,
        generation: 3,
    });
    let mut table = TableSelection::new(table_key, table_key, table_key);
    table.anchor = Point::text(table_key, lexical_model::Utf16Offset(6));
    let value = Selection::Table(table).with_foreign_value_metadata(true, None);
    let data = ledger.capture(
        &value,
        ForeignSelectionIdentity::default(),
        5,
        Origin::Frozen,
    )?;
    assert!(matches!(
        data,
        compat::CompatSelectionData::CompatTableSelection { .. }
    ));
    let (roundtrip, cached, _) = decode(data)?;
    assert_eq!(roundtrip, value);
    assert!(roundtrip.is_dirty());
    assert_eq!(cached, None);
    let mut nodes = NodeSelection::new();
    nodes.add(table_key);
    nodes.add(NodeKey::ROOT);
    let reference = ledger.allocate(
        Selection::Node(nodes).with_foreign_value_metadata(false, None),
        6,
        1,
    )?;
    let original = encode(&ledger.get(reference)?);
    let patched = ledger.patch(
        reference,
        original.clone(),
        Scope {
            historical: true,
            state_version: 7,
            update: 2,
            activate: false,
        },
    )?;
    assert_eq!(encode(&patched), original);
    assert!(!patched.value.is_dirty());
    let mismatched = encode(&ledger.get(reference)?);
    let (_, _, node_ref) = decode(mismatched)?;
    let range = compat::CompatSelectionData::CompatRangeSelection {
        reference: node_ref,
        anchor: point(Point::element(NodeKey::ROOT, lexical_model::ChildIndex(0))),
        focus: point(Point::element(NodeKey::ROOT, lexical_model::ChildIndex(0))),
        format: 0,
        style: vec![],
        dirty: false,
        has_cached_backward: false,
        cached_backward: false,
        has_cached_nodes: false,
        cached_nodes: vec![],
    };
    assert!(
        ledger
            .patch(
                reference,
                range,
                Scope {
                    historical: false,
                    state_version: 7,
                    update: 2,
                    activate: false
                }
            )
            .is_err()
    );
    Ok(())
}

#[test]
fn allocation_has_no_implicit_lease_and_decoder_retain_is_balanced() -> Result<(), BoundaryError> {
    let mut ledger = SelectionValues::new(7);
    let reference = ledger.allocate(Selection::Range(RangeSelection::at_root()), 1, 1)?;
    assert!(ledger.release(reference).is_err());
    ledger.retain(reference)?;
    ledger.release_graph(1);
    assert!(ledger.get(reference).is_ok());
    ledger.release(reference)?;
    assert!(ledger.get(reference).is_err());
    let unretained = ledger.allocate(Selection::Range(RangeSelection::at_root()), 2, 2)?;
    ledger.release_graph(2);
    assert!(ledger.get(unretained).is_err());
    Ok(())
}
