//! A typed time entry shows on its task's cached first page, with the task's
//! Time logged moved, before the server answers; a refusal takes both back,
//! and the server's reply replaces them.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::link_patch::{LinkOperation, LinkPathSegment, OptimisticLinkPatch, RecordRoot};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::record_selection::RecordSelection;
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const PROPERTIES: &str = r#"properties { id propertyDefinitionId value {
  __typename ... on GraphqlNumberPropertyValue { numberValue: value }
} }"#;
const TIME_LOGGED: &str = "00000001-0000-0000-0000-000000000016";

fn query() -> String {
    format!(
        r#"query TaskTimeEntries($input: SoupEntityInput!) {{
  user {{ id soupEntity(input: $input) {{ __typename id ... on GraphqlSoupDocument {{
    {PROPERTIES}
    timeEntries(limit: 50) {{ entries {{ id minutes }} nextCursor }}
  }} }} }}
}}"#
    )
}

fn log_mutation() -> String {
    format!(
        r#"mutation LogTime($input: LogTimeInput!) {{
  logTime(input: $input) {{
    entry {{ id minutes }}
    task {{ __typename id {PROPERTIES} timeEntries(limit: 50) {{ entries {{ id minutes }} nextCursor }} }}
  }}
}}"#
    )
}

fn delete_mutation() -> String {
    format!(
        r#"mutation DeleteTimeEntry($input: DeleteTimeEntryInput!) {{
  deleteTimeEntry(input: $input) {{
    deletedEntryId
    task {{ __typename id {PROPERTIES} timeEntries(limit: 50) {{ entries {{ id minutes }} nextCursor }} }}
  }}
}}"#
    )
}

const PARENT: &str = r#"fragment TimeEntriesParent on GraphqlSoupDocument {
  __typename id timeEntries(limit: 50) { entries { id } }
}"#;

fn variables() -> serde_json::Map<String, Json> {
    json!({"input": {"entityType": "DOCUMENT", "entityId": "task-1"}})
        .as_object()
        .unwrap()
        .clone()
}

fn time_logged(id: &str, minutes: u32) -> Json {
    json!({"id": id, "propertyDefinitionId": TIME_LOGGED,
        "value": {"__typename": "GraphqlNumberPropertyValue", "numberValue": minutes}})
}

fn entry(id: &str, minutes: u32) -> Json {
    json!({"id": id, "minutes": minutes})
}

fn patch(operation: LinkOperation) -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        record_root: Some(RecordRoot {
            fragment_name: "TimeEntriesParent".into(),
            entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
        }),
        query: PARENT.into(),
        operation_name: None,
        variables_json: "{}".into(),
        path: vec![
            LinkPathSegment::Field {
                field: "timeEntries".into(),
            },
            LinkPathSegment::Field {
                field: "entries".into(),
            },
        ],
        operation,
    }
}

async fn seeded(properties: Json, entries: Json) -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    engine
        .write_query(
            None,
            &query(),
            Some("TaskTimeEntries"),
            &variables(),
            &json!({"user": {"id": "user-1", "soupEntity": {
                "__typename": "GraphqlSoupDocument", "id": "task-1",
                "properties": properties,
                "timeEntries": {"entries": entries, "nextCursor": null},
            }}}),
            None,
        )
        .await
        .unwrap();
    engine
}

async fn task(engine: &mut Engine<InMemoryStorage>) -> Json {
    let ReadResult::Hit { data, .. } = engine
        .read_query(Some(1), &query(), Some("TaskTimeEntries"), &variables())
        .await
        .unwrap()
    else {
        panic!("the task's entries must stay readable");
    };
    data["user"]["soupEntity"].clone()
}

async fn enqueue(
    engine: &mut Engine<InMemoryStorage>,
    uuid: &str,
    mutation: &str,
    name: &str,
    data: &Json,
    patches: &[OptimisticLinkPatch],
) -> u64 {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                identity_bindings: &[],
                uuid,
                query: mutation,
                operation_name: Some(name),
                variables: &json!({"input": {}}).as_object().unwrap().clone(),
                data,
                link_patches: patches,
                revalidations: &[],
                created_at_ms: 1,
            },
        )
        .await
        .unwrap()
        .0
}

async fn claim(engine: &mut Engine<InMemoryStorage>) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 2,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "test".into(),
        generation: claimed.lease_generation,
    }
}

const NEW_ENTRY: &str = "0196a000-0000-7000-8000-000000000002";

fn optimistic_log() -> Json {
    json!({"logTime": {
        "entry": entry(NEW_ENTRY, 30),
        "task": {"__typename": "GraphqlSoupDocument", "id": "task-1",
            "properties": [time_logged("time-logged-1", 120)]},
    }})
}

fn log_patch() -> OptimisticLinkPatch {
    patch(LinkOperation::PrependUnique {
        entity_key: EntityKey(format!("GraphqlTimeEntry:{NEW_ENTRY}").into()),
    })
}

#[test]
fn a_typed_entry_and_its_total_show_before_the_reply_and_leave_on_refusal() {
    block_on(async {
        let mut engine = seeded(
            json!([time_logged("time-logged-1", 90)]),
            json!([entry("entry-1", 90)]),
        )
        .await;
        let txn = enqueue(
            &mut engine,
            NEW_ENTRY,
            &log_mutation(),
            "LogTime",
            &optimistic_log(),
            &[log_patch()],
        )
        .await;

        let pending = task(&mut engine).await;
        assert_eq!(
            pending["timeEntries"]["entries"],
            json!([entry(NEW_ENTRY, 30), entry("entry-1", 90)])
        );
        assert_eq!(pending["properties"][0]["value"]["numberValue"], 120);

        let claim = claim(&mut engine).await;
        engine.rollback_optimistic_write(txn, claim).await.unwrap();
        let refused = task(&mut engine).await;
        assert_eq!(
            refused["timeEntries"]["entries"],
            json!([entry("entry-1", 90)])
        );
        assert_eq!(refused["properties"][0]["value"]["numberValue"], 90);
    });
}

#[test]
fn the_reply_replaces_the_prediction_with_the_servers_page_and_total() {
    block_on(async {
        let mut engine = seeded(json!([]), json!([])).await;
        let first_log = json!({"logTime": {
            "entry": entry(NEW_ENTRY, 30),
            "task": {"__typename": "GraphqlSoupDocument", "id": "task-1",
                "properties": [time_logged("optimistic-property:DOCUMENT:task-1", 30)]},
        }});
        let txn = enqueue(
            &mut engine,
            NEW_ENTRY,
            &log_mutation(),
            "LogTime",
            &first_log,
            &[log_patch()],
        )
        .await;
        assert_eq!(
            task(&mut engine).await["properties"][0]["id"],
            "optimistic-property:DOCUMENT:task-1"
        );

        let claim = claim(&mut engine).await;
        engine
            .commit_optimistic_write(
                txn,
                claim,
                &log_mutation(),
                Some("LogTime"),
                &json!({"input": {}}).as_object().unwrap().clone(),
                &json!({"logTime": {
                    "entry": entry(NEW_ENTRY, 30),
                    "task": {"__typename": "GraphqlSoupDocument", "id": "task-1",
                        "properties": [time_logged("time-logged-1", 30)],
                        "timeEntries": {"entries": [entry(NEW_ENTRY, 30)], "nextCursor": null}},
                }}),
            )
            .await
            .unwrap();
        let committed = task(&mut engine).await;
        assert_eq!(
            committed["properties"],
            json!([time_logged("time-logged-1", 30)])
        );
        assert_eq!(
            committed["timeEntries"]["entries"],
            json!([entry(NEW_ENTRY, 30)])
        );
    });
}

#[test]
fn a_deleted_entry_leaves_the_page_and_the_total_until_a_refusal_restores_it() {
    block_on(async {
        let mut engine = seeded(
            json!([time_logged("time-logged-1", 120)]),
            json!([entry(NEW_ENTRY, 30), entry("entry-1", 90)]),
        )
        .await;
        let txn = enqueue(
            &mut engine,
            "6f4c3c2e-8d1b-4c1a-9b7e-2a5d4e3f1c00",
            &delete_mutation(),
            "DeleteTimeEntry",
            &json!({"deleteTimeEntry": {
                "deletedEntryId": NEW_ENTRY,
                "task": {"__typename": "GraphqlSoupDocument", "id": "task-1",
                    "properties": [time_logged("time-logged-1", 90)]},
            }}),
            &[patch(LinkOperation::Remove {
                entity_key: EntityKey(format!("GraphqlTimeEntry:{NEW_ENTRY}").into()),
            })],
        )
        .await;

        let pending = task(&mut engine).await;
        assert_eq!(
            pending["timeEntries"]["entries"],
            json!([entry("entry-1", 90)])
        );
        assert_eq!(pending["properties"][0]["value"]["numberValue"], 90);

        let claim = claim(&mut engine).await;
        engine.rollback_optimistic_write(txn, claim).await.unwrap();
        let restored = task(&mut engine).await;
        assert_eq!(
            restored["timeEntries"]["entries"],
            json!([entry(NEW_ENTRY, 30), entry("entry-1", 90)])
        );
        assert_eq!(restored["properties"][0]["value"]["numberValue"], 120);
    });
}

async fn parent_records(engine: &mut Engine<InMemoryStorage>) -> usize {
    let selection = RecordSelection::parse(
        cache_core::meta::bundled_schema_ref(),
        PARENT,
        "TimeEntriesParent",
    )
    .unwrap();
    engine
        .read_records_by_keys(
            &selection,
            &[EntityKey("GraphqlSoupDocument:task-1".into())],
        )
        .await
        .unwrap()
        .value
        .len()
}

/// The web reads the parent first and sends the list patch only when the
/// page is cached: a record-rooted patch on a missing page fails the enqueue.
#[test]
fn a_task_whose_entries_were_never_read_queues_a_log_without_the_list_link() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                &format!(
                    "query Properties($input: SoupEntityInput!) {{ user {{ id soupEntity(input: $input) {{ __typename id ... on GraphqlSoupDocument {{ {PROPERTIES} }} }} }} }}"
                ),
                Some("Properties"),
                &variables(),
                &json!({"user": {"id": "user-1", "soupEntity": {
                    "__typename": "GraphqlSoupDocument", "id": "task-1", "properties": [],
                }}}),
                None,
            )
            .await
            .unwrap();
        assert_eq!(parent_records(&mut engine).await, 0);

        let refused = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    client_metadata: None,
                    identity_bindings: &[],
                    uuid: NEW_ENTRY,
                    query: &log_mutation(),
                    operation_name: Some("LogTime"),
                    variables: &json!({"input": {}}).as_object().unwrap().clone(),
                    data: &optimistic_log(),
                    link_patches: &[log_patch()],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await;
        assert!(refused.is_err());

        let txn = enqueue(
            &mut engine,
            NEW_ENTRY,
            &log_mutation(),
            "LogTime",
            &optimistic_log(),
            &[],
        )
        .await;
        let claim = claim(&mut engine).await;
        engine
            .commit_optimistic_write(
                txn,
                claim,
                &log_mutation(),
                Some("LogTime"),
                &json!({"input": {}}).as_object().unwrap().clone(),
                &json!({"logTime": {
                    "entry": entry(NEW_ENTRY, 30),
                    "task": {"__typename": "GraphqlSoupDocument", "id": "task-1",
                        "properties": [time_logged("time-logged-1", 30)],
                        "timeEntries": {"entries": [entry(NEW_ENTRY, 30)], "nextCursor": null}},
                }}),
            )
            .await
            .unwrap();
        assert_eq!(parent_records(&mut engine).await, 1);
        assert_eq!(
            task(&mut engine).await["timeEntries"]["entries"],
            json!([entry(NEW_ENTRY, 30)])
        );
    });
}
