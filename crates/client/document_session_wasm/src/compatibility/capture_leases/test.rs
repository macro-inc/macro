use super::*;

fn reference(id: u64, version: u64) -> compat::ForeignRecordRef {
    compat::ForeignRecordRef {
        node: compat::ForeignNodeRef {
            editor_id: 7,
            version,
            key: compat::ForeignKey {
                index: 1,
                generation: 2,
            },
            instance_owner_id: 3,
            class_id: 4,
            instance_id: 5,
        },
        update_id: 6,
        access: compat::ForeignAccess::Read,
        capture_id: id,
    }
}

fn request(retain: &[u64], release: &[u64]) -> compat::CompatCaptureLeases {
    compat::CompatCaptureLeases {
        editor_id: 7,
        retain: retain.to_vec(),
        release: release.to_vec(),
    }
}

#[test]
fn invalid_late_id_editor_and_underflow_are_atomic() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    leases.emit(reference(2, 10))?;
    let before = leases.clone();
    for invalid in [
        request(&[1, 99], &[]),
        request(&[1], &[99]),
        request(&[1], &[2]),
        compat::CompatCaptureLeases {
            editor_id: 8,
            ..request(&[1], &[])
        },
    ] {
        assert!(leases.apply(&invalid).is_err());
        assert_eq!(leases, before);
    }
    assert!(leases.emit(reference(0, 10)).is_err());
    let mut foreign = reference(3, 10);
    foreign.node.editor_id = 8;
    assert!(leases.emit(foreign).is_err());
    assert_eq!(leases, before);
    Ok(())
}

#[test]
fn aggregate_retain_overflow_is_checked_before_release_or_pin_transfer() -> Result<(), BoundaryError>
{
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    leases.emit(reference(2, 10))?;
    leases.apply(&request(&[2], &[]))?;
    leases.entries.get_mut(&2).expect("capture").explicit = u64::MAX - 1;
    let before = leases.clone();
    assert!(leases.apply(&request(&[1, 2, 2], &[2])).is_err());
    assert_eq!(leases, before);
    Ok(())
}

#[test]
fn retain_then_release_same_id_transfers_pins_and_prunes_once() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    assert_eq!(leases.apply(&request(&[1, 1], &[1, 1]))?, vec![1]);
    assert!(leases.entries.is_empty());
    assert!(leases.graphs.is_empty());
    assert!(leases.retire_graph(10).is_empty());
    assert!(leases.emit(reference(1, 10)).is_err());
    Ok(())
}

#[test]
fn replacement_binding_retains_before_the_previous_binding_releases() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    leases.apply(&request(&[1], &[]))?;
    assert!(leases.apply(&request(&[1], &[1]))?.is_empty());
    assert_eq!(leases.entries[&1].explicit, 1);
    assert!(leases.retire_graph(10).is_empty());
    assert_eq!(leases.apply(&request(&[], &[1]))?, vec![1]);
    Ok(())
}

#[test]
fn duplicate_emission_requires_every_authority_field_to_match() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    let original = reference(1, 10);
    leases.emit(original)?;
    leases.emit(original)?;
    let before = leases.clone();
    for field in 0..8 {
        let mut changed = original;
        match field {
            0 => changed.node.version = 11,
            1 => changed.node.key.index = 9,
            2 => changed.node.key.generation = 9,
            3 => changed.node.instance_owner_id = 9,
            4 => changed.node.class_id = 9,
            5 => changed.node.instance_id = 9,
            6 => changed.update_id = 9,
            _ => changed.access = compat::ForeignAccess::Frozen,
        }
        assert!(leases.emit(changed).is_err());
        assert_eq!(leases, before);
    }
    Ok(())
}

#[test]
fn reemitting_explicitly_held_capture_does_not_repin_or_leak() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    let captured = reference(1, 10);
    leases.emit(captured)?;
    assert!(leases.apply(&request(&[1], &[]))?.is_empty());
    let before = leases.clone();
    leases.emit(captured)?;
    leases.emit(captured)?;
    assert_eq!(leases, before);
    // The graph is still alive; explicit ownership has already replaced its pins.
    assert_eq!(leases.apply(&request(&[], &[1]))?, vec![1]);
    assert!(leases.retire_graph(10).is_empty());
    Ok(())
}

#[test]
fn graph_retirement_preserves_explicit_and_native_ownership() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    for id in 1..=3 {
        leases.emit(reference(id, 10))?;
    }
    leases.apply(&request(&[1], &[]))?;
    leases.hold(NativeOwner::Stage(3), &[2])?;
    assert_eq!(leases.retire_graph(10), vec![3]);
    assert_eq!(leases.apply(&request(&[], &[1]))?, vec![1]);
    assert_eq!(leases.release_owner(NativeOwner::Stage(3)), vec![2]);
    assert!(leases.entries.is_empty());
    Ok(())
}

#[test]
fn abandoned_graph_keeps_emitted_reply_until_fenced_or_retained() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    leases.emit(reference(2, 10))?;
    assert!(leases.abandon_graph(10).is_empty());
    assert!(!leases.entries[&1].graph);
    assert!(leases.entries[&1].emission);
    leases.apply(&request(&[1], &[]))?;
    assert_eq!(leases.retire_graph(10), vec![2]);
    assert_eq!(leases.apply(&request(&[], &[1]))?, vec![1]);
    Ok(())
}

#[test]
fn native_owners_are_idempotent_isolated_and_release_only_their_ids() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    leases.emit(reference(2, 11))?;
    leases.hold(NativeOwner::Update(1), &[1, 1])?;
    leases.hold(NativeOwner::Update(1), &[1])?;
    leases.hold(NativeOwner::Stage(1), &[1, 2])?;
    assert!(leases.retire_graph(10).is_empty());
    assert!(leases.retire_graph(11).is_empty());
    assert!(leases.release_owner(NativeOwner::Update(1)).is_empty());
    assert!(leases.release_owner(NativeOwner::Update(1)).is_empty());
    assert_eq!(leases.release_owner(NativeOwner::Stage(1)), vec![1, 2]);
    Ok(())
}

#[test]
fn native_hold_bad_late_id_and_overflow_do_not_partially_acquire() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    leases.emit(reference(2, 10))?;
    let before = leases.clone();
    assert!(leases.hold(NativeOwner::Update(1), &[1, 99]).is_err());
    assert_eq!(leases, before);
    leases.entries.get_mut(&2).expect("capture").native = u64::MAX;
    let before = leases.clone();
    assert!(leases.hold(NativeOwner::Stage(2), &[1, 2]).is_err());
    assert_eq!(leases, before);
    Ok(())
}

#[test]
fn valid_noop_prunes_and_unrelated_versions_have_no_effect() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    leases.emit(reference(1, 10))?;
    let before = leases.clone();
    assert!(leases.apply(&request(&[], &[]))?.is_empty());
    assert!(leases.retire_graph(99).is_empty());
    assert!(leases.abandon_graph(99).is_empty());
    assert!(leases.release_owner(NativeOwner::Stage(99)).is_empty());
    assert_eq!(leases, before);
    assert_eq!(leases.retire_graph(10), vec![1]);
    assert!(leases.retire_graph(10).is_empty());
    Ok(())
}

#[test]
fn retired_id_ranges_allow_out_of_order_emission_but_never_reuse() -> Result<(), BoundaryError> {
    let mut leases = CaptureLeases::new(7);
    for id in [3, 1, 2, u64::MAX] {
        leases.emit(reference(id, id))?;
        assert_eq!(leases.retire_graph(id), vec![id]);
    }
    assert_eq!(leases.retired.get(&1), Some(&3));
    assert_eq!(leases.retired.get(&u64::MAX), Some(&u64::MAX));
    for id in [1, 2, 3, u64::MAX] {
        assert!(leases.emit(reference(id, id)).is_err());
    }
    Ok(())
}
