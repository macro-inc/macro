use super::*;

fn facts(key: NodeKey) -> Vec<FfiDecorator> {
    vec![FfiDecorator {
        key,
        text: "fixture".into(),
        is_inline: false,
        is_keyboard_selectable: true,
        media: None,
        block_format: None,
    }]
}
fn signature(key: NodeKey, value: Option<&str>) -> Vec<DecoratorRenderChange> {
    vec![DecoratorRenderChange {
        key,
        policy: value.map(|value| {
            DecoratorRenderPolicy::Signature(DecoratorRenderSignature::new(value.into()))
        }),
    }]
}
#[test]
fn only_acknowledged_facts_activate_and_advance_the_native_view() {
    let key = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 3,
    });
    let mut view = NativeDecoratorView::default();
    let lease = view.begin().unwrap();
    let batch = view
        .stage(lease, 7, facts(key), signature(key, Some("A")), vec![])
        .unwrap();
    assert_eq!(view.observer.exposed_revision(key), None);
    assert!(view.phase == ViewPhase::PreparingRemount);
    view.finish(lease, batch.token, 7, false).unwrap();
    assert_eq!(view.observer.exposed_revision(key), None);
    let batch = view
        .stage(lease, 7, facts(key), signature(key, Some("A")), vec![])
        .unwrap();
    view.finish(lease, batch.token, 7, true).unwrap();
    assert!(view.phase == ViewPhase::Exposed);
    assert_eq!(view.observer.exposed_revision(key), Some(0));
    let pending = view
        .stage(lease, 7, facts(key), signature(key, Some("B")), vec![])
        .unwrap();
    assert!(matches!(
        pending.revisions.as_slice(),
        [DiffOp::SetDecoratorRevision { revision: 1, .. }]
    ));
    assert!(
        view.stage(lease, 7, facts(key), signature(key, Some("C")), vec![])
            .is_err()
    );
    view.finish(lease, pending.token, 7, false).unwrap();
    let final_a = view
        .stage(lease, 7, facts(key), signature(key, Some("A")), vec![])
        .unwrap();
    assert!(matches!(
        final_a.revisions.as_slice(),
        [DiffOp::SetDecoratorRevision { revision: 0, .. }]
    ));
    view.finish(lease, final_a.token, 7, true).unwrap();
    assert!(view.finish(lease, final_a.token, 7, true).is_err());
    let remount = view.begin().unwrap();
    assert!(!view.retire(lease));
    assert!(
        view.stage(lease, 7, facts(key), signature(key, Some("B")), vec![])
            .is_err()
    );
    let batch = view
        .stage(remount, 7, facts(key), signature(key, Some("C")), vec![])
        .unwrap();
    assert!(matches!(
        batch.revisions.as_slice(),
        [DiffOp::SetDecoratorRevision { revision: 0, .. }]
    ));
    assert_eq!(view.observer.exposed_revision(key), None);
    assert!(view.retire(remount));
    assert!(view.finish(remount, batch.token, 7, true).is_err());
}
#[test]
fn removal_only_and_opt_out_batches_require_actual_acknowledgment() {
    let key = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 3,
    });
    let mut view = NativeDecoratorView::default();
    let lease = view.begin().unwrap();
    let batch = view
        .stage(lease, 7, facts(key), signature(key, Some("A")), vec![])
        .unwrap();
    view.finish(lease, batch.token, 7, true).unwrap();
    let opt_out = view
        .stage(lease, 7, facts(key), signature(key, None), vec![])
        .unwrap();
    assert_eq!(opt_out.reset_revisions, vec![key]);
    view.finish(lease, opt_out.token, 7, false).unwrap();
    assert_eq!(view.observer.exposed_revision(key), Some(0));
    let removed = view
        .stage(lease, 7, vec![], signature(key, None), vec![key])
        .unwrap();
    assert_eq!(view.observer.exposed_revision(key), Some(0));
    assert!(view.finish(lease, removed.token + 1, 7, true).is_err());
    assert_eq!(
        view.finish(lease, removed.token, 7, true).unwrap(),
        vec![key]
    );
    assert_eq!(view.observer.exposed_revision(key), None);
}
#[test]
fn acknowledged_packet_is_its_captured_policy_not_the_newer_model_publication() {
    let key = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 3,
    });
    let mut view = NativeDecoratorView::default();
    let lease = view.begin().unwrap();
    let a = view
        .stage(lease, 7, facts(key), signature(key, Some("A")), vec![])
        .unwrap();
    view.finish(lease, a.token, 7, true).unwrap();
    let b = view
        .stage(lease, 7, facts(key), signature(key, Some("B")), vec![])
        .unwrap();
    let mut queue = native_diff::PendingDecorators::default();
    queue.project(lexical_model::Diff {
        generation: 7,
        full_reconcile: false,
        view_text_matches: None,
        ops: vec![],
        decorator_renders: signature(key, Some("C")),
    });
    view.finish(lease, b.token, 7, true).unwrap();
    let c = view
        .stage(lease, 7, facts(key), signature(key, Some("C")), vec![])
        .unwrap();
    assert!(matches!(
        c.revisions.as_slice(),
        [DiffOp::SetDecoratorRevision { revision: 2, .. }]
    ));
    assert!(
        matches!(queue.policies.get(&key), Some(DecoratorRenderPolicy::Signature(value)) if value.as_str()=="C")
    );
    assert!(view.finish(lease, c.token, 8, true).is_err());
    view.finish(lease, c.token, 8, false).unwrap();
}
