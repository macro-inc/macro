use super::*;

#[test]
fn concrete_union_member_outside_selected_fragment_is_absent() {
    let fields = BTreeMap::from([(
        "__typename".to_string(),
        CacheValue::String("GraphqlSoupChannel".to_string()),
    )]);
    // These are selections beneath the GraphqlSoupEntity union. The cached
    // channel does not match the document-only fragment containing properties.
    let selections = vec![Selection::Fragment {
        type_condition: Some("GraphqlSoupDocument".to_string()),
        selection_set: vec![Selection::Field(FieldNode {
            response_key: "properties".to_string(),
            name: "properties".to_string(),
            arguments: Vec::new(),
            selection_set: Vec::new(),
        })],
    }];

    let result = resolve_fields_owner(
        &HashMap::new(),
        &fields,
        "GraphqlSoupChannel",
        &selections,
        &["properties".to_string()],
    )
    .unwrap();

    assert!(matches!(result, OwnerResolution::Absent));
}
