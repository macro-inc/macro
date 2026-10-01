use super::*;
use crate::deps::DepIndex;
use crate::value::CacheValue;

#[test]
fn field_proof_is_optional_and_replaced_on_registration() {
    let viewer = EntityKey::entity(SOUP_PAGE_OWNER, &["viewer"]);
    let document = EntityKey::entity("GraphqlSoupDocument", &["doc"]);
    let mut index = DepIndex::new();
    for (op, field) in [(1, "soup(a)"), (2, "soup(b)")] {
        let mut deps = QueryDependencies::default();
        deps.record(&viewer);
        deps.record(&document);
        deps.field(&viewer, SOUP_PAGE_OWNER, field);
        index.set_query_deps(op, deps);
    }
    index.set_op_deps(3, [viewer.clone()].into());
    index.set_op_broad(4);
    let changes = [(viewer.clone(), ["soup(a)".into()].into())].into();
    assert_eq!(
        index.ops_for_changes(&[viewer.clone()].into(), &changes),
        [1, 3, 4].into()
    );
    assert_eq!(
        index.ops_for_changes(&[document].into(), &changes),
        [1, 2, 4].into()
    );
    assert_eq!(
        index.ops_for_changes(&[viewer.clone()].into(), &ViewerFields::new()),
        [1, 2, 3, 4].into()
    );
    index.remove_op(1);
    index.set_op_deps(2, [viewer.clone()].into());
    assert_eq!(
        index.ops_for_changes(&[viewer].into(), &changes),
        [2, 3, 4].into()
    );
}

#[test]
fn captures_retention_removals_without_copying_page_payloads() {
    let before = Record {
        fields: [
            (
                "__typename".into(),
                CacheValue::String(SOUP_PAGE_OWNER.into()),
            ),
            ("soup(old)".into(), CacheValue::Null),
        ]
        .into(),
    };
    let update = Record {
        fields: [("soup(new)".into(), CacheValue::Null)].into(),
    };
    let capture = ViewerFieldUpdate::capture(&before, &update).unwrap();
    let mut after = before.clone();
    after.fields.remove("soup(old)");
    after.fields.extend(update.fields);
    let fields = capture.finish(&after).unwrap();
    assert_eq!(fields, ["soup(old)".into(), "soup(new)".into()].into());
    assert_eq!(
        changed_viewer_fields(Some(&before), Some(&after)),
        Some(fields)
    );
    assert_eq!(changed_viewer_fields(None, Some(&after)), None);
    assert_eq!(changed_viewer_fields(Some(&before), None), None);
}
