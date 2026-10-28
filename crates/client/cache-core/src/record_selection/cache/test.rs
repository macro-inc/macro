use super::*;

#[test]
fn plans_are_reused_but_both_document_and_fragment_are_part_of_identity() {
    let mut selections = RecordSelectionCache::default();
    let document =
        "fragment A on GraphqlSoupDocument { id } fragment B on GraphqlSoupDocument { name }";
    let first = selections
        .get(
            crate::meta::bundled_schema_ref(),
            document.into(),
            "A".into(),
        )
        .unwrap();
    let again = selections
        .get(
            crate::meta::bundled_schema_ref(),
            document.into(),
            "A".into(),
        )
        .unwrap();
    assert!(Arc::ptr_eq(&first, &again));
    let other = selections
        .get(
            crate::meta::bundled_schema_ref(),
            document.into(),
            "B".into(),
        )
        .unwrap();
    assert!(!Arc::ptr_eq(&first, &other));
    let changed = selections
        .get(
            crate::meta::bundled_schema_ref(),
            "fragment A on GraphqlSoupDocument { name }".into(),
            "A".into(),
        )
        .unwrap();
    assert!(!Arc::ptr_eq(&first, &changed));
    assert!(
        selections
            .get(
                crate::meta::bundled_schema_ref(),
                document.into(),
                "Missing".into()
            )
            .is_err()
    );
    assert_eq!(selections.plans.len(), 3);
}

#[test]
fn eviction_is_bounded_and_keeps_recent_plans() {
    let mut selections = RecordSelectionCache::default();
    let document = |i| format!("fragment F{i} on GraphqlSoupDocument {{ id }}");
    let first = selections
        .get(crate::meta::bundled_schema_ref(), document(0), "F0".into())
        .unwrap();
    for i in 1..CAPACITY {
        selections
            .get(
                crate::meta::bundled_schema_ref(),
                document(i),
                format!("F{i}"),
            )
            .unwrap();
    }
    assert!(Arc::ptr_eq(
        &first,
        &selections
            .get(crate::meta::bundled_schema_ref(), document(0), "F0".into())
            .unwrap()
    ));
    selections
        .get(
            crate::meta::bundled_schema_ref(),
            document(CAPACITY),
            format!("F{CAPACITY}"),
        )
        .unwrap();
    assert_eq!(selections.plans.len(), CAPACITY);
    assert!(selections.plans.contains(&(
        document(0),
        "F0".into(),
        crate::meta::bundled_schema_ref().hash().to_owned()
    )));
    assert!(!selections.plans.contains(&(
        document(1),
        "F1".into(),
        crate::meta::bundled_schema_ref().hash().to_owned()
    )));
}
