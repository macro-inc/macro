use crate::*;

#[test]
fn every_native_diff_field_has_an_explicit_ffi_projection_decision() {
    let key = NodeKey::from_parts(KeyParts {
        index: 7,
        generation: 3,
    });
    let signature = "private-native-signature";
    // Deliberately no struct update: a new core field must break this fixture and its projection.
    let diff = Diff {
        generation: 3,
        full_reconcile: false,
        view_text_matches: Some(key),
        ops: vec![DiffOp::SetDecoratorRevision {
            key,
            revision: u64::MAX,
        }],
        decorator_renders: vec![DecoratorRenderChange {
            key,
            policy: Some(DecoratorRenderPolicy::Signature(
                DecoratorRenderSignature::new(signature.into()),
            )),
        }],
    };
    let mut pending = native_diff::PendingDecorators::default();
    let projected = pending.project(diff);
    assert_eq!(projected.decorator_keys, vec![key]);
    assert_eq!(
        pending.policies.get(&key),
        Some(&DecoratorRenderPolicy::Signature(
            DecoratorRenderSignature::new(signature.into())
        ))
    );
    let mut bytes = Vec::new();
    <FfiDiff as uniffi::FfiConverter<UniFfiTag>>::write(projected, &mut bytes);
    assert!(
        !bytes
            .windows(signature.len())
            .any(|value| value == signature.as_bytes())
    );
    let mut input = bytes.as_slice();
    let projected = <FfiDiff as uniffi::FfiConverter<UniFfiTag>>::try_read(&mut input).unwrap();
    assert!(input.is_empty());
    assert_eq!(projected.generation, 3);
    assert!(!projected.full_reconcile);
    assert_eq!(projected.view_text_matches, Some(key));
    assert_eq!(
        projected.ops,
        vec![DiffOp::SetDecoratorRevision {
            key,
            revision: u64::MAX
        }]
    );
    assert_eq!(projected.decorator_keys, vec![key]);
    // The DTO has no domain policy field and provides no wire-to-domain reconstruction.
    assert_eq!(pending.policies.len(), 1);
}

#[test]
fn native_diff_operation_tags_append_revision_without_reassigning_legacy_tags() {
    let key = NodeKey::ROOT;
    for (op, tag) in [
        (
            DiffOp::Remove {
                key,
                subtree_root: true,
            },
            1_i32,
        ),
        (DiffOp::State { key, state: None }, 11),
        (
            DiffOp::SetDecoratorRevision {
                key,
                revision: u64::MAX,
            },
            12,
        ),
    ] {
        let mut bytes = Vec::new();
        <DiffOp as uniffi::FfiConverter<UniFfiTag>>::write(op.clone(), &mut bytes);
        assert_eq!(&bytes[..4], &tag.to_be_bytes());
        let mut input = bytes.as_slice();
        assert_eq!(
            <DiffOp as uniffi::FfiConverter<UniFfiTag>>::try_read(&mut input).unwrap(),
            op
        );
        assert!(input.is_empty());
    }
}
