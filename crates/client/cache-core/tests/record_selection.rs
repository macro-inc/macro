use cache_core::engine::{BeginOptimisticWrite, Engine, EngineError};
use cache_core::record_selection::{RecordSelection, RecordSelectionError};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

fn record(type_name: &str, fields: impl IntoIterator<Item = (&'static str, CacheValue)>) -> Record {
    let mut values = BTreeMap::from([(
        "__typename".to_string(),
        CacheValue::String(type_name.to_string()),
    )]);
    values.extend(
        fields
            .into_iter()
            .map(|(name, value)| (name.to_string(), value)),
    );
    Record { fields: values }
}

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_string().into())
}

fn linked_document(id: &str, property: Option<EntityKey<'static>>) -> (EntityKey<'static>, Record) {
    let mut fields = vec![("id", CacheValue::String(id.to_string()))];
    if let Some(property) = property {
        fields.push((
            "properties",
            CacheValue::List(vec![CacheValue::Ref(property)]),
        ));
    }
    (
        key(&format!("GraphqlSoupDocument:{id}")),
        record("GraphqlSoupDocument", fields),
    )
}

fn property(id: &str, name: &str) -> (EntityKey<'static>, Record) {
    (
        key(&format!("GraphqlProperty:{id}")),
        record(
            "GraphqlProperty",
            [
                ("id", CacheValue::String(id.to_string())),
                ("displayName", CacheValue::String(name.to_string())),
            ],
        ),
    )
}

fn document(id: &str, name: &str) -> (EntityKey<'static>, Record) {
    (
        key(&format!("GraphqlSoupDocument:{id}")),
        record(
            "GraphqlSoupDocument",
            [
                ("id", CacheValue::String(id.to_string())),
                ("name", CacheValue::String(name.to_string())),
            ],
        ),
    )
}

const ITEM_FRAGMENT: &str = r#"
fragment SoupItemFields on GraphqlSoupDocument {
  documentId: id
  properties {
    id
    propertyName: displayName
  }
}
"#;

#[test]
fn projects_cold_links_and_skips_incomplete_explicit_keys() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch(vec![
                linked_document("a", Some(key("GraphqlProperty:a"))),
                linked_document("b", None),
                linked_document("c", Some(key("GraphqlProperty:c"))),
                property("a", "Alpha"),
                property("c", "Charlie"),
            ])
            .await
            .unwrap();
        let mut engine = Engine::with_capacity(storage, 1);
        let selection = RecordSelection::parse(ITEM_FRAGMENT, "SoupItemFields").unwrap();

        let selected = engine
            .read_records_by_keys(
                &selection,
                &[
                    key("GraphqlSoupDocument:a"),
                    key("GraphqlSoupDocument:b"),
                    key("GraphqlSoupDocument:c"),
                ],
            )
            .await
            .unwrap();
        assert_eq!(selected.revision, engine.current_revision());
        assert_eq!(selected.revision.to_string(), "0");
        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].record["documentId"], json!("a"));
        assert_eq!(
            selected[0].record["properties"][0]["propertyName"],
            json!("Alpha")
        );
        assert_eq!(selected[1].record["documentId"], json!("c"));
        assert_eq!(
            selected[1].record["properties"][0]["propertyName"],
            json!("Charlie")
        );
    });
}

#[test]
fn explicit_key_projection_preserves_rank_order_without_scanning() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch(vec![document("a", "Alpha"), document("c", "Charlie")])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let selection =
            RecordSelection::parse("fragment Item on GraphqlSoupDocument { id name }", "Item")
                .unwrap();

        let selected = engine
            .read_records_by_keys(
                &selection,
                &[
                    key("GraphqlSoupDocument:c"),
                    key("GraphqlSoupDocument:a"),
                    key("GraphqlSoupDocument:c"),
                    key("GraphqlSoupDocument:missing"),
                ],
            )
            .await
            .unwrap();
        assert_eq!(
            selected
                .iter()
                .map(|selected| selected.record_key.as_ref())
                .collect::<Vec<_>>(),
            ["GraphqlSoupDocument:c", "GraphqlSoupDocument:a"]
        );
        assert_eq!(selected[0].record, json!({"id": "c", "name": "Charlie"}));

        let too_many = vec![key("GraphqlSoupDocument:a"); 501];
        assert!(matches!(
            engine.read_records_by_keys(&selection, &too_many).await,
            Err(EngineError::RecordSelection(
                RecordSelectionError::TooManyKeys { .. }
            ))
        ));
        assert!(matches!(
            engine
                .read_records_by_keys(&selection, &[key("ROOT_QUERY")])
                .await,
            Err(EngineError::RecordSelection(
                RecordSelectionError::InvalidKey
            ))
        ));
    });
}

#[test]
fn reads_schema_incomplete_objects_in_explicit_input_order() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        // These records intentionally omit other current, non-null schema
        // fields. A fragment selecting only persisted fields remains complete.
        storage
            .put_batch(vec![
                document("b", "Beta"),
                document("a", "Alpha"),
                (
                    key("GraphqlSoupChat:c"),
                    record(
                        "GraphqlSoupChat",
                        [
                            ("id", CacheValue::String("c".to_string())),
                            ("name", CacheValue::String("Chat".to_string())),
                        ],
                    ),
                ),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let selection = RecordSelection::parse(
            r#"fragment Entity on GraphqlSoupEntity {
                __typename
                ... on GraphqlSoupDocument { id name }
                ... on GraphqlSoupChat { id name }
            }"#,
            "Entity",
        )
        .unwrap();

        let selected = engine
            .read_records_by_keys(
                &selection,
                &[
                    key("GraphqlSoupChat:c"),
                    key("GraphqlSoupDocument:a"),
                    key("GraphqlSoupDocument:b"),
                ],
            )
            .await
            .unwrap();
        assert_eq!(
            selected
                .iter()
                .map(|selected| selected.record["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["c", "a", "b"]
        );
    });
}

#[test]
fn merges_optimistic_updates_with_cold_linked_bases() {
    block_on(async {
        let property_key = key("GraphqlProperty:property-1");
        let document_key = key("GraphqlSoupDocument:doc-1");
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch(vec![
                (
                    document_key,
                    record(
                        "GraphqlSoupDocument",
                        [
                            ("id", CacheValue::String("doc-1".to_string())),
                            (
                                "properties",
                                CacheValue::List(vec![CacheValue::Ref(property_key.clone())]),
                            ),
                        ],
                    ),
                ),
                (
                    property_key,
                    record(
                        "GraphqlProperty",
                        [
                            ("id", CacheValue::String("property-1".to_string())),
                            (
                                "propertyDefinitionId",
                                CacheValue::String("definition-1".to_string()),
                            ),
                            ("displayName", CacheValue::String("Old".to_string())),
                        ],
                    ),
                ),
            ])
            .await
            .unwrap();
        let mut engine = Engine::with_capacity(storage, 1);
        let selection = RecordSelection::parse(
            r#"fragment Item on GraphqlSoupDocument {
                id
                properties { id propertyDefinitionId displayName }
            }"#,
            "Item",
        )
        .unwrap();
        let mutation = r#"mutation SetProperty($input: SetEntityPropertyInput!) {
            setEntityProperty(input: $input) { id displayName }
        }"#;
        let Json::Object(variables) = json!({
            "input": {
                "entityType": "DOCUMENT",
                "entityId": "doc-1",
                "propertyDefinitionId": "definition-1"
            }
        }) else {
            unreachable!()
        };
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: mutation,
                    operation_name: Some("SetProperty"),
                    variables: &variables,
                    data: &json!({
                        "setEntityProperty": {
                            "id": "property-1",
                            "displayName": "Optimistic"
                        }
                    }),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();

        let selected = engine
            .read_records_by_keys(&selection, &[key("GraphqlSoupDocument:doc-1")])
            .await
            .unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected[0].record["properties"][0],
            json!({
                "id": "property-1",
                "propertyDefinitionId": "definition-1",
                "displayName": "Optimistic"
            })
        );
    });
}

#[test]
fn includes_optimistic_only_records() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let selection = RecordSelection::parse(
            "fragment Property on GraphqlProperty { id displayName }",
            "Property",
        )
        .unwrap();
        let mutation = r#"mutation SetProperty($input: SetEntityPropertyInput!) {
            setEntityProperty(input: $input) { id displayName }
        }"#;
        let Json::Object(variables) = json!({
            "input": {
                "entityType": "DOCUMENT",
                "entityId": "doc-1",
                "propertyDefinitionId": "definition-1",
                "value": { "string": "todo" }
            }
        }) else {
            unreachable!()
        };
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: mutation,
                    operation_name: Some("SetProperty"),
                    variables: &variables,
                    data: &json!({
                        "setEntityProperty": {
                            "id": "property-1",
                            "displayName": "Status"
                        }
                    }),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();

        let selected = engine
            .read_records_by_keys(&selection, &[key("GraphqlProperty:property-1")])
            .await
            .unwrap();
        assert_eq!(
            selected[0].record,
            json!({"id": "property-1", "displayName": "Status"})
        );
    });
}
