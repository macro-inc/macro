//! `@fromCache` fields: never fetched by the query that selects them, read
//! from whatever another query stored under the same field key.

use cache_core::engine::live_query::ResponsePathSegment;
use cache_core::engine::watch_query::QueryUpdate;
use cache_core::engine::{Engine, NetworkWrite, QueryRegistration, ReadResult};
use cache_core::meta::{BUNDLED_SCHEMA_SDL, Schema};
use cache_core::revision::CacheRevision;
use cache_core::store::InMemoryStorage;
use cache_core::value::{EntityKey, Record};
use pollster::block_on;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

const PAGE: &str = r#"
query EmailThreadPage($threadId: ID!) {
  user {
    id
    emailThread(input: { threadId: $threadId }) {
      __typename
      id
      messages(offset: 0, limit: 2) {
        __typename
        id
        subject
        deviceValue(version: 1) @fromCache { version html }
      }
    }
  }
}
"#;

const BODIES: &str = r#"
query EmailThreadDeviceValues($threadId: ID!, $version: Int!) {
  user {
    id
    emailThread(input: { threadId: $threadId }) {
      __typename
      id
      messages(offset: 0, limit: 2) {
        __typename
        id
        deviceValue(version: $version) { version html }
      }
    }
  }
}
"#;

fn engine() -> Engine<InMemoryStorage> {
    let schema = Schema::from_sdl(&format!(
        "{BUNDLED_SCHEMA_SDL}
        type FromCacheTestValue {{ version: Int! html: String! }}
        extend type GraphqlSoupEmailMessage {{
          deviceValue(version: Int!): FromCacheTestValue
        }}"
    ))
    .unwrap();
    Engine::with_schema(InMemoryStorage::new(), 64, schema)
}

fn page_variables() -> serde_json::Map<String, Json> {
    json!({"threadId": "thread"}).as_object().unwrap().clone()
}

fn bodies_variables() -> serde_json::Map<String, Json> {
    json!({"threadId": "thread", "version": 1})
        .as_object()
        .unwrap()
        .clone()
}

/// The page response: the server never returns `deviceValue`.
fn page_response() -> Json {
    json!({"user": {"id": "viewer", "emailThread": {
        "__typename": "GraphqlSoupEmailThread",
        "id": "thread",
        "messages": [
            {"__typename": "GraphqlSoupEmailMessage", "id": "m1", "subject": "Hello"},
            {"__typename": "GraphqlSoupEmailMessage", "id": "m2", "subject": "Re: Hello"}
        ]
    }}})
}

fn bodies_response(html: &str) -> Json {
    json!({"user": {"id": "viewer", "emailThread": {
        "__typename": "GraphqlSoupEmailThread",
        "id": "thread",
        "messages": [
            {"__typename": "GraphqlSoupEmailMessage", "id": "m1",
             "deviceValue": {"version": 1, "html": html}},
            {"__typename": "GraphqlSoupEmailMessage", "id": "m2", "deviceValue": null}
        ]
    }}})
}

fn page_result(first_body: Json) -> Json {
    json!({"user": {"id": "viewer", "emailThread": {
        "__typename": "GraphqlSoupEmailThread",
        "id": "thread",
        "messages": [
            {"__typename": "GraphqlSoupEmailMessage", "id": "m1", "subject": "Hello",
             "deviceValue": first_body},
            {"__typename": "GraphqlSoupEmailMessage", "id": "m2", "subject": "Re: Hello",
             "deviceValue": null}
        ]
    }}})
}

async fn read_page(engine: &mut Engine<InMemoryStorage>) -> Json {
    let ReadResult::Hit { data } = engine
        .read_query(None, PAGE, None, &page_variables())
        .await
        .unwrap()
    else {
        panic!("expected a cache hit");
    };
    data
}

async fn register_page(engine: &mut Engine<InMemoryStorage>, op_id: u64, data: &Json) {
    engine
        .write_query_with_registration(
            None,
            Some(QueryRegistration {
                op_id,
                entity_resolvers: &[],
            }),
            NetworkWrite {
                query: PAGE,
                operation_name: None,
                variables: &page_variables(),
                data,
                identity: None,
            },
        )
        .await
        .unwrap();
}

#[test]
fn reads_a_from_cache_field_as_null_until_another_query_stores_it() {
    block_on(async {
        let mut engine = engine();
        engine
            .write_query(None, PAGE, None, &page_variables(), &page_response(), None)
            .await
            .unwrap();
        assert_eq!(read_page(&mut engine).await, page_result(Json::Null));

        // A variable and a literal argument resolve to the same field key.
        engine
            .write_query(
                None,
                BODIES,
                None,
                &bodies_variables(),
                &bodies_response("<p>Hello</p>"),
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            read_page(&mut engine).await,
            page_result(json!({"version": 1, "html": "<p>Hello</p>"}))
        );
    });
}

#[test]
fn a_stored_value_missing_selected_fields_reads_as_null() {
    block_on(async {
        let mut engine = engine();
        engine
            .write_query(None, PAGE, None, &page_variables(), &page_response(), None)
            .await
            .unwrap();
        let versions_only = BODIES.replace("{ version html }", "{ version }");
        engine
            .write_query(
                None,
                &versions_only,
                None,
                &bodies_variables(),
                &json!({"user": {"id": "viewer", "emailThread": {
                    "__typename": "GraphqlSoupEmailThread",
                    "id": "thread",
                    "messages": [
                        {"__typename": "GraphqlSoupEmailMessage", "id": "m1",
                         "deviceValue": {"version": 1}},
                        {"__typename": "GraphqlSoupEmailMessage", "id": "m2", "deviceValue": null}
                    ]
                }}}),
                None,
            )
            .await
            .unwrap();
        // Without the null, every read of the page would miss and refetch a
        // response that can never supply the field.
        assert_eq!(read_page(&mut engine).await, page_result(Json::Null));
    });
}

#[test]
fn a_value_linking_another_record_reads_like_an_ordinary_link_once_stored() {
    block_on(async {
        let mut engine = engine();
        let latest = r#"
            query Latest($threadId: ID!) {
              user { id emailThread(input: { threadId: $threadId }) {
                __typename id latestContentMessage @fromCache { __typename id subject }
              } }
            }"#;
        engine
            .write_query(
                None,
                latest,
                None,
                &page_variables(),
                &json!({"user": {"id": "viewer", "emailThread": {
                    "__typename": "GraphqlSoupEmailThread", "id": "thread"
                }}}),
                None,
            )
            .await
            .unwrap();
        let read = engine
            .read_query(None, latest, None, &page_variables())
            .await
            .unwrap();
        assert!(matches!(
            read,
            ReadResult::Hit { data } if data["user"]["emailThread"]["latestContentMessage"].is_null()
        ));

        // A linked record may be loaded from storage after the walk suspends,
        // so a missing subfield misses whether or not the record is hot.
        engine
            .write_query(
                None,
                &latest.replace("@fromCache { __typename id subject }", "{ __typename id }"),
                None,
                &page_variables(),
                &json!({"user": {"id": "viewer", "emailThread": {
                    "__typename": "GraphqlSoupEmailThread", "id": "thread",
                    "latestContentMessage": {"__typename": "GraphqlSoupEmailMessage", "id": "m1"}
                }}}),
                None,
            )
            .await
            .unwrap();
        let read = engine
            .read_query(None, latest, None, &page_variables())
            .await
            .unwrap();
        assert!(matches!(read, ReadResult::Miss));

        engine
            .write_query(None, PAGE, None, &page_variables(), &page_response(), None)
            .await
            .unwrap();
        let read = engine
            .read_query(None, latest, None, &page_variables())
            .await
            .unwrap();
        assert!(matches!(
            read,
            ReadResult::Hit { data } if data["user"]["emailThread"]["latestContentMessage"]
                == json!({"__typename": "GraphqlSoupEmailMessage", "id": "m1", "subject": "Hello"})
        ));
    });
}

#[test]
fn network_writes_keep_stored_values_and_exact_dependencies() {
    block_on(async {
        let mut engine = engine();
        engine
            .write_query(
                None,
                BODIES,
                None,
                &bodies_variables(),
                &bodies_response("<p>Hello</p>"),
                None,
            )
            .await
            .unwrap();
        // Even a value a server returned must not replace the stored one.
        let mut response = page_response();
        response["user"]["emailThread"]["messages"][0]["deviceValue"] = Json::Null;
        register_page(&mut engine, 7, &response).await;
        assert_eq!(
            read_page(&mut engine).await,
            page_result(json!({"version": 1, "html": "<p>Hello</p>"}))
        );

        // A value that can link to records the response cannot name makes
        // the registration broad.
        let latest = r#"
            query Latest($threadId: ID!) {
              user { id emailThread(input: { threadId: $threadId }) {
                __typename id latestContentMessage @fromCache { __typename id subject }
              } }
            }"#;
        engine
            .write_query_with_registration(
                None,
                Some(QueryRegistration {
                    op_id: 8,
                    entity_resolvers: &[],
                }),
                NetworkWrite {
                    query: latest,
                    operation_name: None,
                    variables: &page_variables(),
                    data: &json!({"user": {"id": "viewer", "emailThread": {
                        "__typename": "GraphqlSoupEmailThread", "id": "thread"
                    }}}),
                    identity: None,
                },
            )
            .await
            .unwrap();

        let unrelated = engine
            .put_records_with_projections(
                None,
                vec![(
                    EntityKey::entity("GraphqlSoupEmailThread", &["other"]),
                    Record {
                        fields: BTreeMap::from([(
                            "id".into(),
                            cache_core::value::CacheValue::String("other".into()),
                        )]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        assert_eq!(unrelated.affected_ops, [8].into());

        let body = engine
            .write_query(
                None,
                BODIES,
                None,
                &bodies_variables(),
                &bodies_response("<p>Edited</p>"),
                None,
            )
            .await
            .unwrap();
        assert_eq!(body.affected_ops, [7, 8].into());
    });
}

#[test]
fn a_watched_query_sees_values_another_query_writes() {
    block_on(async {
        let mut engine = engine();
        engine
            .write_query(None, PAGE, None, &page_variables(), &page_response(), None)
            .await
            .unwrap();
        let mut snapshot = Json::Null;
        let mut revision = apply(
            &mut snapshot,
            engine
                .watch_query(1, PAGE, None, &page_variables(), &[], None)
                .await
                .unwrap(),
        );
        assert_eq!(snapshot, page_result(Json::Null));

        for html in ["<p>Hello</p>", "<p>Edited</p>"] {
            let write = engine
                .write_query(
                    None,
                    BODIES,
                    None,
                    &bodies_variables(),
                    &bodies_response(html),
                    None,
                )
                .await
                .unwrap();
            assert!(write.affected_ops.contains(&1));
            revision = apply(
                &mut snapshot,
                engine
                    .watch_query(1, PAGE, None, &page_variables(), &[], Some(revision))
                    .await
                    .unwrap(),
            );
            assert_eq!(snapshot, page_result(json!({"version": 1, "html": html})));
        }
    });
}

/// Applies a watch update the way the web document reader does.
fn apply(snapshot: &mut Json, update: QueryUpdate) -> CacheRevision {
    match update {
        QueryUpdate::Hit { data, revision } => {
            *snapshot = Json::clone(&data);
            revision.parse().unwrap()
        }
        QueryUpdate::Patch { patches, revision } => {
            for patch in patches {
                let mut slot = &mut *snapshot;
                for segment in patch.path {
                    slot = match segment {
                        ResponsePathSegment::Field(name) => slot.get_mut(name.as_str()),
                        ResponsePathSegment::Index(index) => slot.get_mut(index),
                    }
                    .expect("patch targets an existing path");
                }
                *slot = patch.value;
            }
            revision.parse().unwrap()
        }
        QueryUpdate::Miss { .. } => panic!("unexpected miss"),
    }
}
