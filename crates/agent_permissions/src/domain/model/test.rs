use std::collections::BTreeSet;

use super::*;

/// The property names of each `oneOf` branch of `T`'s OpenAPI schema.
fn schema_fields<T: utoipa::PartialSchema>() -> Vec<BTreeSet<String>> {
    let schema = serde_json::to_value(T::schema()).unwrap();
    schema["oneOf"]
        .as_array()
        .unwrap()
        .iter()
        .map(|branch| {
            branch["properties"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect()
        })
        .collect()
}

fn wire_fields(value: &impl Serialize) -> BTreeSet<String> {
    serde_json::to_value(value)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect()
}

/// What a source's scope serializes as is what the OpenAPI document (and so
/// every generated client) says it is.
#[test]
fn a_source_scope_serializes_as_its_schema_says() {
    let schema = schema_fields::<SourceScope>();
    for scope in [
        SourceScope::Personal,
        SourceScope::Team {
            team_id: Uuid::nil(),
        },
    ] {
        let wire = wire_fields(&scope);
        assert!(schema.contains(&wire), "{wire:?} not in {schema:?}");
    }
    assert_eq!(
        serde_json::to_value(SourceScope::Team {
            team_id: Uuid::nil()
        })
        .unwrap(),
        serde_json::json!({ "kind": "team", "teamId": Uuid::nil() })
    );
}
