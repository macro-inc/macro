use super::*;

#[test]
fn concrete_union_member_outside_selected_fragment_is_absent() {
    let fields = BTreeMap::from([(
        "__typename".to_string(),
        CacheValue::String("GraphqlSoupChannel".to_string()),
    )]);
    // These are selections beneath the GraphqlSoupEntity interface. The cached
    // channel does not match the document-only fragment containing properties.
    let selections = vec![Selection::Fragment {
        type_condition: Some("GraphqlSoupDocument".to_string()),
        selection_set: vec![Selection::Field(FieldNode {
            response_key: "properties".to_string(),
            name: "properties".to_string(),
            cache_only: false,
            arguments: Vec::new(),
            selection_set: Vec::new(),
        })],
    }];

    let records = HashMap::new();
    let result = resolve_fields_owner(
        &records,
        &fields,
        "GraphqlSoupChannel",
        &selections,
        &["properties".to_string()],
    )
    .unwrap();

    assert!(matches!(result, OwnerResolution::Absent));
}

#[test]
fn variable_filters_match_recursive_partial_objects_with_or_semantics() {
    let Json::Object(variables) = serde_json::json!({
        "input": {
            "continuation": {
                "groupBy": {
                    "field": "PROPERTY",
                    "propertyDefinitionId": "status-def"
                },
                "groupKey": "in-progress",
                "cursor": "cursor-1"
            }
        }
    }) else {
        unreachable!()
    };
    let Json::Object(unrelated) = serde_json::json!({
        "input": {"initial": {"groupBy": {"field": "PROPERTY"}}}
    }) else {
        unreachable!()
    };
    let Json::Object(relevant) = serde_json::json!({
        "input": {"continuation": {"groupBy": {
            "field": "PROPERTY",
            "propertyDefinitionId": "status-def"
        }}}
    }) else {
        unreachable!()
    };

    assert!(matches_variable_filters(&variables, &[]));
    assert!(matches_variable_filters(&variables, &[unrelated, relevant]));
}

#[test]
fn variable_filters_reject_different_or_missing_nested_values() {
    let Json::Object(variables) = serde_json::json!({
        "input": {"initial": {"groupBy": {
            "field": "PROPERTY",
            "propertyDefinitionId": "status-def"
        }}}
    }) else {
        unreachable!()
    };
    let Json::Object(different) = serde_json::json!({
        "input": {"initial": {"groupBy": {"propertyDefinitionId": "priority-def"}}}
    }) else {
        unreachable!()
    };
    let Json::Object(missing) = serde_json::json!({
        "input": {"continuation": {"groupBy": {"propertyDefinitionId": "status-def"}}}
    }) else {
        unreachable!()
    };

    assert!(!matches_variable_filters(&variables, &[different, missing]));
}
