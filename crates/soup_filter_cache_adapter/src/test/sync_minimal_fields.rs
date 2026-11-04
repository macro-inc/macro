//! The streamed sync's first pass selects minimal Task/Document rows. They must
//! stay complete for the local filter index, so lists can filter, sort and
//! group them without the network. These tests drive the real sync path
//! (NDJSON frames through `Engine::sync_apply_next` on Turso) with the same
//! projection composition the browser and native hosts use for hydration.

use super::*;
use crate::mail::ProjectionError;
use cache_core::engine::Engine;
use cache_core::predicate::{PredicateQueryResult, ProjectionMutation};
use cache_core::sync::{SyncHooks, SyncPageWrite, SyncRun, SyncStartArgs};
use cache_core::value::EntityKey;
use cache_turso::{TursoStorage, TursoStorageError};
use serde_json::{Map, Value, json};

const STATUS: u128 = 900;
const STATUS_OPEN: u128 = 901;
const STATUS_DONE: u128 = 902;
const PRIORITY: u128 = 910;
const PRIORITY_HIGH: u128 = 911;
const DUE: u128 = 920;
const DUE_AT: &str = "2026-11-18T00:00:00Z";
const TASK: u128 = 1;
const DOCUMENT: u128 = 2;

const PROPERTY_VALUE_FRAGMENT: &str = r#"fragment SoupPropertyValueFields on GraphqlPropertyValue {
  __typename
  ... on GraphqlBooleanPropertyValue { boolValue: value }
  ... on GraphqlNumberPropertyValue { numberValue: value }
  ... on GraphqlStringPropertyValue { stringValue: value }
  ... on GraphqlDatePropertyValue { dateValue: value }
  ... on GraphqlDateRangePropertyValue { rangeStart: start rangeEnd: end }
  ... on GraphqlSelectOptionPropertyValue { optionIds }
  ... on GraphqlEntityReferencePropertyValue { references { entityId entityType specificMessageId } }
  ... on GraphqlLinkPropertyValue { urls }
}"#;

/// Section 3 of SYNC-STREAM.md, as proposed: `(response key, selection)`.
const PROPOSED: [(&str, &str); 11] = [
    ("name", "name"),
    ("ownerId", "ownerId"),
    ("fileType", "fileType"),
    ("projectId", "projectId"),
    ("createdAt", "createdAt"),
    ("updatedAt", "updatedAt"),
    ("viewedAt", "viewedAt"),
    ("deletedAt", "deletedAt"),
    (
        "subType",
        "subType { __typename ... on GraphqlTaskSubType { isCompleted } }",
    ),
    (
        "properties",
        "properties { id propertyDefinitionId value { ...SoupPropertyValueFields } }",
    ),
    (
        "notifications",
        "notifications { __typename id entityId entityType state }",
    ),
];

/// The confirmed first-pass selection: the proposal plus `isFavorited`.
fn confirmed() -> Vec<(&'static str, &'static str)> {
    let mut fields = PROPOSED.to_vec();
    fields.push(("isFavorited", "isFavorited"));
    fields
}

fn id(n: u128) -> String {
    uuid::Uuid::from_u128(n).to_string()
}

fn key(n: u128) -> RecordKey {
    RecordKey::new(format!("GraphqlSoupDocument:{}", id(n))).unwrap()
}

fn query(fields: &[(&str, &str)]) -> String {
    let selections = fields
        .iter()
        .map(|(_, selection)| *selection)
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "query SoupBackfillSyncTasks($input: SoupInput!) {{
  user {{
    id
    soup(input: $input) {{
      items {{
        __typename
        id
        cacheProjection
        ... on GraphqlSoupDocument {{
{selections}
        }}
      }}
      nextCursor
    }}
  }}
}}
{PROPERTY_VALUE_FRAGMENT}"
    )
}

fn select_property(definition: u128, option: u128) -> Value {
    json!({
        "id": id(definition * 1000 + option),
        "propertyDefinitionId": id(definition),
        "value": {"__typename": "GraphqlSelectOptionPropertyValue", "optionIds": [id(option)]},
    })
}

/// Every field a row could select; `item` keeps only the selected ones, so
/// the adapter never sees a fact the query did not ask for.
fn full_item(n: u128, task: bool) -> Map<String, Value> {
    let supplement = document_supplement_with_task_facts(
        &id(n),
        false,
        false,
        if task {
            vec![uuid::Uuid::from_u128(STATUS_OPEN)]
        } else {
            Vec::new()
        },
    );
    json!({
        "__typename": "GraphqlSoupDocument",
        "id": id(n),
        "cacheProjection": supplement,
        "name": if task { "Write the plan" } else { "Plan.pdf" },
        "ownerId": "macro|owner@example.com",
        "fileType": if task { Value::Null } else { json!("pdf") },
        "projectId": null,
        "createdAt": "2026-10-01T00:00:00.000001Z",
        "updatedAt": if task { "2026-10-02T00:00:00.000001Z" } else { "2026-10-03T00:00:00.000001Z" },
        "viewedAt": null,
        "deletedAt": null,
        "subType": if task {
            json!({"__typename": "GraphqlTaskSubType", "isCompleted": false})
        } else {
            Value::Null
        },
        "properties": if task {
            json!([
                select_property(STATUS, STATUS_OPEN),
                select_property(PRIORITY, PRIORITY_HIGH),
                {
                    "id": id(DUE * 1000),
                    "propertyDefinitionId": id(DUE),
                    "value": {"__typename": "GraphqlDatePropertyValue", "dateValue": DUE_AT},
                },
            ])
        } else {
            json!([])
        },
        "notifications": if task {
            json!([])
        } else {
            json!([{
                "__typename": "GraphqlNotification", "id": id(500), "entityId": id(n),
                "entityType": "DOCUMENT", "state": "UNSEEN",
            }])
        },
        "isFavorited": false,
    })
    .as_object()
    .unwrap()
    .clone()
}

fn item(n: u128, task: bool, fields: &[(&str, &str)]) -> Value {
    let mut item = full_item(n, task);
    item.retain(|field, _| {
        ["__typename", "id", "cacheProjection"].contains(&field.as_str())
            || fields.iter().any(|(selected, _)| selected == field)
    });
    Value::Object(item)
}

fn lane(fields: &[(&str, &str)]) -> Value {
    json!({
        "id": "tasks",
        "query": query(fields),
        "operationName": "SoupBackfillSyncTasks",
        "variables": {"input": {"initial": {"limit": 500}}},
        "paging": "soup",
        "kind": {"kind": "hydrate"},
        "passStartedAt": "2026-11-01T00:00:00.000Z",
    })
}

fn stream(fields: &[(&str, &str)]) -> Vec<u8> {
    let page = json!({
        "type": "page", "lane": "tasks", "page": 0,
        "variables": {"input": {"initial": {"limit": 500}}},
        "response": {"data": {"user": {"id": "macro|owner@example.com", "soup": {
            "items": [item(TASK, true, fields), item(DOCUMENT, false, fields)],
            "nextCursor": null,
        }}}},
        "items": 2,
        "nextVariables": null,
    });
    let frames = [
        page,
        json!({"type": "laneDone", "lane": "tasks", "pages": 1, "items": 2, "reason": "complete"}),
        json!({"type": "end", "reason": "complete"}),
    ];
    frames
        .iter()
        .flat_map(|frame| {
            let mut line = serde_json::to_vec(frame).unwrap();
            line.push(b'\n');
            line
        })
        .collect()
}

/// The hosts' hydration composition (cache-wasm `hydration_projections`,
/// the native plugin's `soup::write_projections`).
struct HostHooks;

impl SyncHooks<TursoStorage> for HostHooks {
    type Error = ProjectionError<TursoStorageError>;

    async fn page_projections(
        &self,
        engine: &mut Engine<TursoStorage>,
        page: SyncPageWrite<'_>,
    ) -> Result<Vec<ProjectionMutation>, Self::Error> {
        let reuse = match page.identity {
            Some(observed) => engine
                .current_identity()
                .await
                .map_err(|error| SoupFilterCacheAdapterError(error.to_string()))?
                .is_none_or(|bound| bound == observed),
            None => true,
        };
        let schema = engine.schema_snapshot();
        let storage = engine.storage();
        let mut projections = authoritative_projection_mutations(
            &schema,
            page.query,
            page.operation_name,
            page.data,
        )?;
        if reuse {
            projections.extend(
                notification_projection_updates(
                    &schema,
                    storage,
                    page.query,
                    page.operation_name,
                    page.variables,
                    page.data,
                )
                .await?,
            );
        }
        projections.extend(
            crate::mail::projection_updates_for_write(
                &schema,
                storage,
                page.query,
                page.operation_name,
                page.variables,
                page.data,
                reuse,
            )
            .await?,
        );
        crate::properties::augment_authoritative(
            &schema,
            storage,
            page.query,
            page.operation_name,
            page.variables,
            page.data,
            reuse,
            projections,
        )
        .await
    }

    async fn deletion_projections(
        &self,
        _engine: &mut Engine<TursoStorage>,
        _keys: &[EntityKey<'static>],
    ) -> Result<Vec<ProjectionMutation>, Self::Error> {
        Ok(Vec::new())
    }

    fn monotonic_ms(&self) -> f64 {
        0.0
    }

    fn wall_clock_ms(&self) -> i64 {
        0
    }
}

/// Syncs one page selecting `fields`. `Err` when the write was refused
/// (the core `SoupBackfill*` guard rejects incomplete document projections).
async fn sync(fields: &[(&str, &str)]) -> Result<Engine<TursoStorage>, String> {
    let mut engine = Engine::new(TursoStorage::open_in_memory("sync-minimal-fields").unwrap());
    let args: SyncStartArgs = serde_json::from_value(json!({
        "url": "https://api.example.test/items/soup/graphql/stream",
        "headers": {},
        "lanes": [lane(fields)],
    }))
    .unwrap();
    let mut run = SyncRun::new(&args, 0.0).unwrap();
    run.push_bytes(&stream(fields)).unwrap();
    while engine
        .sync_apply_next(&mut run, &HostHooks)
        .await
        .map_err(|error| error.to_string())?
        .is_some()
    {}
    run.finish(0.0).map_err(|error| error.to_string())?;
    Ok(engine)
}

fn documents(task: Value, properties: Option<Value>) -> ValidatedIndexQuery {
    let nil = uuid::Uuid::nil().to_string();
    let mut filters = json!({
        "documentFilter": task,
        "calendarEventFilter": {"literal":{"id":nil}},
        "projectFilter": {"literal":{"projectIdSelf":nil}},
        "chatFilter": {"literal":{"chatId":nil}},
        "emailFilter": {"tree":{"literal":{"threadId":nil}}},
        "channelFilter": {"literal":{"channelId":nil}},
        "channelThreadFilter": {"literal":{"threadId":nil}},
        "callFilter": {"literal":{"callId":nil}},
        "crmCompanyFilter": {"literal":{"id":nil}},
        "foreignEntityFilter": {"literal":{"id":nil}}
    });
    if let Some(properties) = properties {
        filters["propertiesFilter"] = properties;
    }
    let SoupFilterCompileOutcome::Supported(query) =
        compile_current_filter_request(filters, "UPDATED_AT", "DESC", 20).unwrap()
    else {
        panic!("document filters must be locally supported");
    };
    query
}

fn both() -> Value {
    json!({"or": {
        "left": {"literal": {"id": id(TASK)}},
        "right": {"literal": {"id": id(DOCUMENT)}},
    }})
}

fn select_option(definition: u128, option: u128) -> Value {
    json!({"literal": {"propertyDefinitionId": id(definition), "value": {"selectOption": id(option)}}})
}

async fn evaluate(
    engine: &mut Engine<TursoStorage>,
    query: ValidatedIndexQuery,
) -> PredicateQueryResult {
    engine.query_predicate_index(&query).await.unwrap().value
}

/// Whether a sync selecting `fields` leaves both rows complete.
async fn complete(fields: &[(&str, &str)]) -> bool {
    match sync(fields).await {
        Ok(mut engine) => {
            evaluate(&mut engine, documents(both(), None)).await
                == PredicateQueryResult::Complete(vec![key(DOCUMENT), key(TASK)])
        }
        Err(_) => false,
    }
}

#[test]
fn the_proposed_selection_alone_is_incomplete_without_is_favorited() {
    pollster::block_on(async {
        // The property guard refuses only operations named exactly
        // `SoupBackfill`, so this page is written, but its rows stay
        // incomplete and every local filter over them falls back to the server.
        let mut engine = sync(&PROPOSED).await.unwrap();
        assert_eq!(
            evaluate(&mut engine, documents(both(), None)).await,
            PredicateQueryResult::Incomplete
        );
    });
}

#[test]
fn the_confirmed_minimal_selection_filters_tasks_and_documents_locally() {
    pollster::block_on(async {
        let mut engine = sync(&confirmed()).await.unwrap();
        // Both rows are complete: an exact local answer, not `Incomplete`.
        assert_eq!(
            evaluate(&mut engine, documents(both(), None)).await,
            PredicateQueryResult::Complete(vec![key(DOCUMENT), key(TASK)])
        );
        // Status and priority select properties evaluate from the selection.
        for (properties, expected) in [
            (select_option(STATUS, STATUS_OPEN), vec![key(TASK)]),
            (select_option(STATUS, STATUS_DONE), vec![]),
            (select_option(PRIORITY, PRIORITY_HIGH), vec![key(TASK)]),
            (
                json!({"and": {"left": select_option(STATUS, STATUS_OPEN), "right": select_option(PRIORITY, PRIORITY_HIGH)}}),
                vec![key(TASK)],
            ),
            (
                json!({"not": select_option(STATUS, STATUS_OPEN)}),
                vec![key(DOCUMENT)],
            ),
        ] {
            assert_eq!(
                evaluate(&mut engine, documents(both(), Some(properties.clone()))).await,
                PredicateQueryResult::Complete(expected),
                "{properties}"
            );
        }
    });
}

#[test]
fn every_required_field_of_the_confirmed_selection_is_needed() {
    pollster::block_on(async {
        let fields = confirmed();
        assert!(complete(&fields).await);
        let mut required = Vec::new();
        for (field, _) in &fields {
            let without = fields
                .iter()
                .filter(|(selected, _)| selected != field)
                .copied()
                .collect::<Vec<_>>();
            if !complete(&without).await {
                required.push(*field);
            }
        }
        // Rendering fields (name, viewedAt, deletedAt) are not needed for
        // index completeness; the rest are.
        assert_eq!(
            required,
            [
                "ownerId",
                "fileType",
                "projectId",
                "createdAt",
                "updatedAt",
                "subType",
                "properties",
                "notifications",
                "isFavorited",
            ]
        );
    });
}
