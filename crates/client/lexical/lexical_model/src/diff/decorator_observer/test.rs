use super::*;
fn patch(value: &str) -> Diff {
    Diff {
        generation: 7,
        full_reconcile: false,
        view_text_matches: None,
        ops: vec![],
        decorator_renders: vec![DecoratorRenderChange {
            key: NodeKey::from_parts(KeyParts {
                generation: 7,
                index: 3,
            }),
            policy: Some(DecoratorRenderPolicy::Signature(
                DecoratorRenderSignature::new(value.into()),
            )),
        }],
    }
}
#[test]
fn prepared_observation_is_owned_acknowledged_once_and_invalidated_on_retire() {
    let mut view = DecoratorRenderObserver::default();
    let other = DecoratorRenderObserver::default();
    let mut a = patch("A");
    let key = a.decorator_renders[0].key;
    let candidate = view.prepare(&mut a, false).unwrap();
    assert_eq!(
        candidate.revision(key),
        DecoratorObservationRevision::Revision(0)
    );
    assert!(matches!(
        other.validate(&candidate),
        Err(Error::Invariant(
            "decorator observation belongs to another view"
        ))
    ));
    assert_eq!(view.exposed_revision(key), None);
    let superseded = view.prepare(&mut patch("B"), false).unwrap();
    view.expose(candidate).unwrap();
    assert_eq!(view.exposed_revision(key), Some(0));
    assert!(matches!(
        view.validate(&superseded),
        Err(Error::Invariant("stale decorator observation"))
    ));
    assert!(matches!(
        view.expose(superseded),
        Err(Error::Invariant("stale decorator observation"))
    ));
    let pending = view.prepare(&mut patch("C"), false).unwrap();
    view.retire();
    assert_eq!(view.exposed_revision(key), None);
    assert!(matches!(
        view.validate(&pending),
        Err(Error::Invariant(
            "decorator observation belongs to another view"
        ))
    ));
}
#[test]
fn revision_and_ack_epoch_exhaustion_leave_view_unchanged() {
    let mut view = DecoratorRenderObserver::default();
    let mut a = patch("A");
    let key = a.decorator_renders[0].key;
    let candidate = view.prepare(&mut a, false).unwrap();
    view.expose(candidate).unwrap();
    view.exposed.get_mut(&key).unwrap().revision = u64::MAX;
    let mut b = patch("B");
    assert!(matches!(
        view.prepare(&mut b, false),
        Err(Error::Invariant("decorator observation revision exhausted"))
    ));
    assert!(b.ops.is_empty());
    assert_eq!(view.exposed_revision(key), Some(u64::MAX));
    view.epoch = u64::MAX;
    assert!(matches!(
        view.prepare(&mut patch("A"), false),
        Err(Error::Invariant("decorator observation epoch exhausted"))
    ));
    assert_eq!(view.exposed_revision(key), Some(u64::MAX));
}
#[test]
fn failed_multi_node_prepare_does_not_append_partial_revision_operations() {
    let mut view = DecoratorRenderObserver::default();
    let mut a = patch("A");
    let mut second = a.decorator_renders[0].clone();
    second.key = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 4,
    });
    a.decorator_renders.push(second);
    let keys: Vec<_> = a
        .decorator_renders
        .iter()
        .map(|change| change.key)
        .collect();
    let initial = view.prepare(&mut a, false).unwrap();
    view.expose(initial).unwrap();
    view.exposed.get_mut(&keys[1]).unwrap().revision = u64::MAX;
    let mut b = patch("B");
    let mut second = b.decorator_renders[0].clone();
    second.key = keys[1];
    b.decorator_renders.push(second);
    assert!(matches!(
        view.prepare(&mut b, false),
        Err(Error::Invariant("decorator observation revision exhausted"))
    ));
    assert!(b.ops.is_empty());
    assert_eq!(view.exposed_revision(keys[0]), Some(0));
    assert_eq!(view.exposed_revision(keys[1]), Some(u64::MAX));
}
