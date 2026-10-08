use super::*;

fn key(s: &str) -> EntityKey<'static> {
    EntityKey(s.to_owned().into())
}

#[test]
fn unchanged_records_replace_field_proof_and_allow_record_only_registration() {
    let viewer = key("GraphqlUser:viewer");
    let records: BTreeSet<_> = [viewer.clone()].into();
    let mut index = DepIndex::new();
    let changes = |field: &str| [(viewer.clone(), [field.to_owned()].into())].into();
    for field in ["soup(a)", "soup(b)"] {
        index.set_query_deps(
            1,
            QueryDependencies {
                records: records.clone(),
                viewer_fields: changes(field),
            },
        );
        assert_eq!(index.ops_for_changes(&records, &changes(field)), [1].into());
    }
    assert!(
        index
            .ops_for_changes(&records, &changes("soup(a)"))
            .is_empty()
    );
    index.set_op_deps(1, records.clone());
    assert_eq!(
        index.ops_for_changes(&records, &changes("soup(a)")),
        [1].into()
    );
    index.remove_op(1);
    assert!(
        index
            .ops_for_changes(&records, &changes("soup(a)"))
            .is_empty()
    );
}

#[test]
fn tracks_and_removes() {
    let mut idx = DepIndex::new();
    idx.set_op_deps(1, [key("A"), key("B")].into());
    idx.set_op_deps(2, [key("B"), key("C")].into());

    assert_eq!(idx.ops_for_keys(&[key("A")]), [1].into());
    assert_eq!(idx.ops_for_keys(&[key("B")]), [1, 2].into());
    assert_eq!(idx.ops_for_keys(&[key("C"), key("A")]), [1, 2].into());

    // Re-registration replaces deps.
    idx.set_op_deps(1, [key("C")].into());
    assert!(idx.ops_for_keys(&[key("A")]).is_empty());

    idx.remove_op(1);
    idx.remove_op(2);
    assert_eq!(idx.active_ops(), 0);
    assert!(idx.ops_for_keys(&[key("B"), key("C")]).is_empty());
}

#[test]
fn broad_registration_is_replaced_and_removed() {
    let mut idx = DepIndex::new();
    idx.set_op_broad(1);
    assert_eq!(idx.ops_for_keys(&[key("anything")]), [1].into());
    assert!(idx.ops_for_keys(std::iter::empty()).is_empty());

    idx.set_op_deps(1, [key("A")].into());
    assert!(idx.ops_for_keys(&[key("B")]).is_empty());
    assert_eq!(idx.ops_for_keys(&[key("A")]), [1].into());

    idx.set_op_broad(1);
    idx.remove_op(1);
    assert!(idx.ops_for_keys(&[key("A")]).is_empty());
    assert_eq!(idx.active_ops(), 0);
}

#[test]
fn repeated_registration_preserves_shared_dependencies_and_teardown() {
    let mut index = DepIndex::new();
    let deps: BTreeSet<_> = [key("A"), key("B")].into();
    index.set_op_deps(1, deps.clone());
    index.set_op_deps(2, [key("B")].into());
    for _ in 0..3 {
        index.set_op_deps(1, deps.clone());
    }
    assert_eq!(index.ops_for_keys(&[key("B")]), [1, 2].into());
    index.set_op_deps(1, [key("C")].into());
    assert!(index.ops_for_keys(&[key("A")]).is_empty());
    assert_eq!(index.ops_for_keys(&[key("B")]), [2].into());
    index.remove_op(1);
    assert!(index.ops_for_keys(&[key("C")]).is_empty());
    assert_eq!(index.active_ops(), 1);
}

#[test]
fn broad_empty_registration_becomes_exact_empty() {
    let mut index = DepIndex::new();
    index.set_op_broad(1);
    index.set_op_deps(1, BTreeSet::new());
    index.set_op_deps(1, BTreeSet::new());
    assert!(index.ops_for_keys(&[key("A")]).is_empty());
    assert_eq!(index.active_ops(), 1);
    index.remove_op(1);
    assert_eq!(index.active_ops(), 0);
}
