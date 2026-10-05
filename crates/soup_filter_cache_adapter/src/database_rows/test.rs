use crate::properties::augment_authoritative;
use cache_core::{
    engine::{Engine, NetworkWrite},
    predicate::PredicateIndexStorage,
};
use serde_json::{Map, Value, json};

const QUERY: &str = include_str!("test/rows.graphql");
const VIEWER: &str = "macro|viewer@databases.test";
const DEALS: &str = "7ab00000-0000-0000-0000-000000000001";
const CONTACTS: &str = "7ab00000-0000-0000-0000-000000000002";
const STAGE: &str = "5e1ec700-0000-0000-0000-000000000001";
const WON: &str = "0e000000-0000-0000-0000-000000000001";
const LOST: &str = "0e000000-0000-0000-0000-000000000002";
const DEAL_1: &str = "70000000-0000-0000-0000-000000000001";
const DEAL_2: &str = "70000000-0000-0000-0000-000000000002";
const DEAL_3: &str = "70000000-0000-0000-0000-000000000003";
const CONTACT: &str = "70000000-0000-0000-0000-000000000004";

async fn write<S: PredicateIndexStorage>(engine: &mut Engine<S>, data: &Value) {
    let core = crate::authoritative_projection_mutations(QUERY, None, data).unwrap();
    let projections =
        augment_authoritative(engine.storage(), QUERY, None, &Map::new(), data, true, core)
            .await
            .unwrap();
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query: QUERY,
                operation_name: None,
                variables: &Map::new(),
                data,
                identity: Some(VIEWER),
            },
            projections,
        )
        .await
        .unwrap();
}

async fn local_rows<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    filters: Value,
) -> Vec<String> {
    let crate::SoupFilterCompileOutcome::Supported(query) =
        crate::compile_current_filter_request(filters, "CREATED_AT", "DESC", 100).unwrap()
    else {
        panic!("a table's rows compile to the local index")
    };
    engine
        .reconcile_predicate_index(&query, &[])
        .await
        .unwrap()
        .value
        .keys
        .into_iter()
        .map(|key| key.as_str().to_owned())
        .collect()
}

#[test]
fn a_tables_rows_are_answered_from_the_cache_and_pick_up_a_new_row() {
    pollster::block_on(async {
        let mut engine = Engine::new(cache_turso::TursoStorage::open_in_memory("rows").unwrap());
        write(
            &mut engine,
            &json!({ "user": { "id": VIEWER, "soup": { "items": [
                    {
                        "__typename": "GraphqlSoupDatabaseRow", "id": DEAL_1, "isFavorited": false,
                        "cacheProjection": null, "notifications": [],
                        "tableId": DEALS, "databaseId": "db000000-0000-0000-0000-000000000001",
                        "ownerId": "macro|owner@databases.test",
                        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
                        "properties": [{
                            "id": "e0000000-0000-0000-0000-000000000001", "propertyDefinitionId": STAGE,
                            "value": { "__typename": "GraphqlSelectOptionPropertyValue", "optionIds": [WON] }
                        }],
                    },
                    {
                        "__typename": "GraphqlSoupDatabaseRow", "id": DEAL_2, "isFavorited": false,
                        "cacheProjection": null, "notifications": [],
                        "tableId": DEALS, "databaseId": "db000000-0000-0000-0000-000000000001",
                        "ownerId": "macro|owner@databases.test",
                        "createdAt": "2026-01-02T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z",
                        "properties": [{
                            "id": "e0000000-0000-0000-0000-000000000002", "propertyDefinitionId": STAGE,
                            "value": { "__typename": "GraphqlSelectOptionPropertyValue", "optionIds": [LOST] }
                        }],
                    },
                    {
                        "__typename": "GraphqlSoupDatabaseRow", "id": CONTACT, "isFavorited": false,
                        "cacheProjection": null, "notifications": [],
                        "tableId": CONTACTS, "databaseId": "db000000-0000-0000-0000-000000000001",
                        "ownerId": "macro|owner@databases.test",
                        "createdAt": "2026-01-04T00:00:00Z", "updatedAt": "2026-01-04T00:00:00Z",
                        "properties": [],
                    }
            ] } } }),
        )
        .await;

        assert_eq!(
            local_rows(&mut engine, json!({
                "databaseRowFilter": { "literal": { "tableId": DEALS } },
                "documentFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "projectFilter": { "literal": { "projectIdSelf": "00000000-0000-0000-0000-000000000000" } },
                "chatFilter": { "literal": { "chatId": "00000000-0000-0000-0000-000000000000" } },
                "emailFilter": { "tree": { "literal": { "threadId": "00000000-0000-0000-0000-000000000000" } } },
                "channelFilter": { "literal": { "channelId": "00000000-0000-0000-0000-000000000000" } },
                "channelThreadFilter": { "literal": { "threadId": "00000000-0000-0000-0000-000000000000" } },
                "calendarEventFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "callFilter": { "literal": { "callId": "00000000-0000-0000-0000-000000000000" } },
                "crmCompanyFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "foreignEntityFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
            })).await,
            vec![
                format!("GraphqlSoupDatabaseRow:{DEAL_2}"),
                format!("GraphqlSoupDatabaseRow:{DEAL_1}"),
            ]
        );
        assert_eq!(
            local_rows(&mut engine, json!({
                "databaseRowFilter": { "literal": { "tableId": DEALS } },
                "documentFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "projectFilter": { "literal": { "projectIdSelf": "00000000-0000-0000-0000-000000000000" } },
                "chatFilter": { "literal": { "chatId": "00000000-0000-0000-0000-000000000000" } },
                "emailFilter": { "tree": { "literal": { "threadId": "00000000-0000-0000-0000-000000000000" } } },
                "channelFilter": { "literal": { "channelId": "00000000-0000-0000-0000-000000000000" } },
                "channelThreadFilter": { "literal": { "threadId": "00000000-0000-0000-0000-000000000000" } },
                "calendarEventFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "callFilter": { "literal": { "callId": "00000000-0000-0000-0000-000000000000" } },
                "crmCompanyFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "foreignEntityFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "propertiesFilter": { "literal": {
                    "propertyDefinitionId": STAGE, "value": { "selectOption": WON }
                } },
            })).await,
            vec![format!("GraphqlSoupDatabaseRow:{DEAL_1}")]
        );

        // A realtime patch carries the new row; the table's rows now hold it.
        write(
            &mut engine,
            &json!({ "user": { "id": VIEWER, "soup": { "items": [
                    {
                        "__typename": "GraphqlSoupDatabaseRow", "id": DEAL_3, "isFavorited": false,
                        "cacheProjection": null, "notifications": [],
                        "tableId": DEALS, "databaseId": "db000000-0000-0000-0000-000000000001",
                        "ownerId": "macro|owner@databases.test",
                        "createdAt": "2026-01-03T00:00:00Z", "updatedAt": "2026-01-03T00:00:00Z",
                        "properties": [{
                            "id": "e0000000-0000-0000-0000-000000000003", "propertyDefinitionId": STAGE,
                            "value": { "__typename": "GraphqlSelectOptionPropertyValue", "optionIds": [WON] }
                        }],
                    }
            ] } } }),
        )
        .await;
        assert_eq!(
            local_rows(&mut engine, json!({
                "databaseRowFilter": { "literal": { "tableId": DEALS } },
                "documentFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "projectFilter": { "literal": { "projectIdSelf": "00000000-0000-0000-0000-000000000000" } },
                "chatFilter": { "literal": { "chatId": "00000000-0000-0000-0000-000000000000" } },
                "emailFilter": { "tree": { "literal": { "threadId": "00000000-0000-0000-0000-000000000000" } } },
                "channelFilter": { "literal": { "channelId": "00000000-0000-0000-0000-000000000000" } },
                "channelThreadFilter": { "literal": { "threadId": "00000000-0000-0000-0000-000000000000" } },
                "calendarEventFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "callFilter": { "literal": { "callId": "00000000-0000-0000-0000-000000000000" } },
                "crmCompanyFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
                "foreignEntityFilter": { "literal": { "id": "00000000-0000-0000-0000-000000000000" } },
            })).await,
            vec![
                format!("GraphqlSoupDatabaseRow:{DEAL_3}"),
                format!("GraphqlSoupDatabaseRow:{DEAL_2}"),
                format!("GraphqlSoupDatabaseRow:{DEAL_1}"),
            ]
        );
    });
}
