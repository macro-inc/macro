use super::*;
use crate::link_patch::{LinkOperation, LinkPathSegment, deduplicate_patches};
use serde_json::json;

fn recipe() -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        query:
            "fragment Parent on GraphqlSoupDocument { id properties { id propertyDefinitionId } }"
                .into(),
        record_root: Some(RecordRoot {
            fragment_name: "Parent".into(),
            entity_key: EntityKey("GraphqlSoupDocument:doc-1".into()),
        }),
        operation_name: None,
        variables_json: "{}".into(),
        path: vec![LinkPathSegment::Field {
            field: "properties".into(),
        }],
        operation: LinkOperation::UpsertByField {
            entity_key: EntityKey("GraphqlProperty:temporary".into()),
            where_field: "propertyDefinitionId".into(),
            equals: json!("priority"),
        },
    }
}

#[test]
fn record_recipes_roundtrip_and_do_not_become_network_queries() {
    let patch = recipe();
    assert_eq!(
        deduplicate_patches(
            crate::meta::bundled_schema_ref(),
            &[patch.clone(), patch.clone()]
        )
        .unwrap(),
        vec![patch.clone()]
    );
    assert_eq!(
        serde_json::from_value::<OptimisticLinkPatch>(serde_json::to_value(&patch).unwrap())
            .unwrap(),
        patch
    );
    assert!(patch.revalidation().is_none());
    assert_eq!(
        patch.root_key(),
        EntityKey("GraphqlSoupDocument:doc-1".into())
    );
}

#[test]
fn legacy_query_recipes_still_deserialize_without_record_root() {
    let wire = json!({
        "query": "query { user { id } }", "variablesJson": "{}",
        "path": [{"field":"user"}],
        "operation": {"kind":"remove", "entityKey":"GraphqlUser:user-1"}
    });
    let patch: OptimisticLinkPatch = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(patch.record_root, None);
    assert_eq!(patch.root_key(), EntityKey::root());
    assert!(patch.revalidation().is_some());
    assert_eq!(serde_json::to_value(patch).unwrap(), wire);
}

#[test]
fn invalid_roots_and_fragments_are_rejected_before_enqueue() {
    let mut cases = Vec::new();
    for key in ["invalid", "GraphqlSoupChat:doc-1", "GraphqlSoupDocument:"] {
        let mut patch = recipe();
        patch.record_root.as_mut().unwrap().entity_key = EntityKey(key.into());
        cases.push(patch);
    }
    for query in [
        "fragment Parent on GraphqlSoupDocument { missing }",
        "fragment Parent on SoupPage { items { id } }",
        "query { user { id } } fragment Parent on GraphqlSoupDocument { id }",
        "fragment Parent on GraphqlUser { soup(input: $input) { items { id } } }",
    ] {
        let mut patch = recipe();
        patch.query = query.into();
        cases.push(patch);
    }
    let mut patch = recipe();
    patch.variables_json = "{\"input\":{}}".into();
    cases.push(patch);
    let mut patch = recipe();
    patch.operation_name = Some("NotAQuery".into());
    cases.push(patch);
    let mut patch = recipe();
    patch.record_root.as_mut().unwrap().fragment_name = "Missing".into();
    cases.push(patch);
    for patch in cases {
        assert!(deduplicate_patches(crate::meta::bundled_schema_ref(), &[patch]).is_err());
    }
}

#[test]
fn resolution_rejects_missing_fields_and_cached_type_mismatches() {
    let patch = recipe();
    let root = patch.record_root.as_ref().unwrap();
    assert!(matches!(
        root.resolve(crate::meta::bundled_schema_ref(), &HashMap::new(), &patch),
        Err(LinkPatchError::MissingParent(_))
    ));
    let mut effective = HashMap::from([(root.entity_key.clone(), Record::default())]);
    assert!(matches!(
        root.resolve(crate::meta::bundled_schema_ref(), &effective, &patch),
        Err(LinkPatchError::MissingField { .. })
    ));
    effective.get_mut(&root.entity_key).unwrap().fields.insert(
        "__typename".into(),
        crate::value::CacheValue::String("GraphqlSoupChat".into()),
    );
    assert!(matches!(
        root.resolve(crate::meta::bundled_schema_ref(), &effective, &patch),
        Err(LinkPatchError::InvalidEntrypoint(_))
    ));
}
