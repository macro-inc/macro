//! Entity-from-argument resolver behavior against the real Soup schema.

use cache_core::engine::{Engine, NetworkWrite, QueryRegistration, ReadResult};
use cache_core::entity_resolver::EntityResolver;
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const SOUP_EMAIL_QUERY: &str = r#"
query SoupEmail($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupEmailThread {
          emailName: name
          ownerId
        }
      }
      nextCursor
    }
  }
}
"#;

const SOUP_EMAIL_WITHOUT_NAME_QUERY: &str = r#"
query SoupEmailWithoutName($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupEmailThread { ownerId }
      }
      nextCursor
    }
  }
}
"#;

const DIRECT_EMAIL_QUERY: &str = r#"
query EmailThread($input: EmailThreadInput!) {
  viewer: user {
    id
    thread: emailThread(input: $input) {
      __typename
      id
      emailName: name
      ownerId
    }
  }
}
"#;

const INLINE_EMAIL_QUERY: &str = r#"
query InlineEmailThread {
  user {
    id
    emailThread(input: { threadId: "thread-1" }) {
      __typename
      id
      name
      ownerId
    }
  }
}
"#;

const NUMERIC_EMAIL_QUERY: &str = r#"
query NumericEmailThread {
  user {
    id
    emailThread(input: { threadId: 42 }) {
      __typename
      id
      name
      ownerId
    }
  }
}
"#;

const UPDATE_EMAIL_MUTATION: &str = r#"
mutation UpdateEmail($input: MarkEmailThreadSeenInput!) {
  markEmailThreadSeen(input: $input) {
    __typename
    id
    name
    ownerId
  }
}
"#;

fn resolver() -> EntityResolver {
    EntityResolver {
        parent_type: "GraphqlUser".to_string(),
        field_name: "emailThread".to_string(),
        target_type: "GraphqlSoupEmailThread".to_string(),
        argument_path: vec!["input".to_string(), "threadId".to_string()],
    }
}

fn object(value: Json) -> serde_json::Map<String, Json> {
    let Json::Object(value) = value else {
        panic!("expected object")
    };
    value
}

fn soup_variables() -> serde_json::Map<String, Json> {
    object(json!({ "input": { "limit": 10 } }))
}

fn direct_variables(id: Json) -> serde_json::Map<String, Json> {
    object(json!({ "input": { "threadId": id } }))
}

fn soup_response(id: Json, name: &str) -> Json {
    json!({
        "user": {
            "id": "user-1",
            "soup": {
                "items": [{
                    "__typename": "GraphqlSoupEmailThread",
                    "id": id,
                    "emailName": name,
                    "ownerId": "user-1"
                }],
                "nextCursor": null
            }
        }
    })
}

async fn seed_thread(engine: &mut Engine<InMemoryStorage>, id: Json, name: &str) {
    engine
        .write_query(
            None,
            SOUP_EMAIL_QUERY,
            Some("SoupEmail"),
            &soup_variables(),
            &soup_response(id, name),
            None,
        )
        .await
        .unwrap();
}

#[test]
fn unseen_direct_relation_misses_without_resolver_and_hits_with_it() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed_thread(&mut engine, json!("thread-1"), "Roadmap").await;
        let variables = direct_variables(json!("thread-1"));

        assert!(matches!(
            engine
                .read_query(None, DIRECT_EMAIL_QUERY, Some("EmailThread"), &variables)
                .await
                .unwrap(),
            ReadResult::Miss
        ));

        let ReadResult::Hit { data } = engine
            .read_query_with_entity_resolvers(
                None,
                DIRECT_EMAIL_QUERY,
                Some("EmailThread"),
                &variables,
                &[resolver()],
            )
            .await
            .unwrap()
        else {
            panic!("expected resolver hit")
        };
        assert_eq!(
            data,
            json!({
                "viewer": {
                    "id": "user-1",
                    "thread": {
                        "__typename": "GraphqlSoupEmailThread",
                        "id": "thread-1",
                        "emailName": "Roadmap",
                        "ownerId": "user-1"
                    }
                }
            })
        );

        // The synthetic relation was not persisted by the resolver read.
        assert!(matches!(
            engine
                .read_query(None, DIRECT_EMAIL_QUERY, Some("EmailThread"), &variables)
                .await
                .unwrap(),
            ReadResult::Miss
        ));
    });
}

#[test]
fn supports_inline_arguments_aliases_and_string_or_numeric_ids() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed_thread(&mut engine, json!("thread-1"), "String id").await;

        let ReadResult::Hit { data } = engine
            .read_query_with_entity_resolvers(
                None,
                INLINE_EMAIL_QUERY,
                Some("InlineEmailThread"),
                &serde_json::Map::new(),
                &[resolver()],
            )
            .await
            .unwrap()
        else {
            panic!("expected inline hit")
        };
        assert_eq!(data["user"]["emailThread"]["name"], json!("String id"));

        seed_thread(&mut engine, json!(42), "Numeric id").await;
        let ReadResult::Hit { data } = engine
            .read_query_with_entity_resolvers(
                None,
                NUMERIC_EMAIL_QUERY,
                Some("NumericEmailThread"),
                &serde_json::Map::new(),
                &[resolver()],
            )
            .await
            .unwrap()
        else {
            panic!("expected numeric hit")
        };
        assert_eq!(data["user"]["emailThread"]["id"], json!(42));
        assert_eq!(data["user"]["emailThread"]["name"], json!("Numeric id"));
    });
}

#[test]
fn absent_incomplete_and_malformed_runtime_values_are_misses() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                SOUP_EMAIL_WITHOUT_NAME_QUERY,
                Some("SoupEmailWithoutName"),
                &soup_variables(),
                &json!({
                    "user": {
                        "id": "user-1",
                        "soup": {
                            "items": [{
                                "__typename": "GraphqlSoupEmailThread",
                                "id": "thread-1",
                                "ownerId": "user-1"
                            }],
                            "nextCursor": null
                        }
                    }
                }),
                None,
            )
            .await
            .unwrap();

        for variables in [
            direct_variables(json!("absent")),
            direct_variables(Json::Null),
            direct_variables(json!({ "bad": true })),
            direct_variables(json!(true)),
            serde_json::Map::new(),
        ] {
            assert!(matches!(
                engine
                    .read_query_with_entity_resolvers(
                        None,
                        DIRECT_EMAIL_QUERY,
                        Some("EmailThread"),
                        &variables,
                        &[resolver()],
                    )
                    .await
                    .unwrap(),
                ReadResult::Miss
            ));
        }

        // The target exists, but `name` was never selected into its record.
        assert!(matches!(
            engine
                .read_query_with_entity_resolvers(
                    None,
                    DIRECT_EMAIL_QUERY,
                    Some("EmailThread"),
                    &direct_variables(json!("thread-1")),
                    &[resolver()],
                )
                .await
                .unwrap(),
            ReadResult::Miss
        ));

        // Rust does not carry generated input metadata yet; an untrusted path
        // that cannot be followed is still safe and behaves as a miss.
        let mut nonexistent_path = resolver();
        nonexistent_path.argument_path = vec!["input".into(), "missing".into()];
        assert!(matches!(
            engine
                .read_query_with_entity_resolvers(
                    None,
                    DIRECT_EMAIL_QUERY,
                    Some("EmailThread"),
                    &direct_variables(json!("thread-1")),
                    &[nonexistent_path],
                )
                .await
                .unwrap(),
            ReadResult::Miss
        ));
    });
}

#[test]
fn resolver_overrides_stored_links_and_null() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed_thread(&mut engine, json!("thread-1"), "Resolved").await;
        let variables = direct_variables(json!("thread-1"));

        engine
            .write_query(
                None,
                DIRECT_EMAIL_QUERY,
                Some("EmailThread"),
                &variables,
                &json!({
                    "viewer": {
                        "id": "user-1",
                        "thread": {
                            "__typename": "GraphqlSoupEmailThread",
                            "id": "thread-2",
                            "emailName": "Stored link",
                            "ownerId": "user-1"
                        }
                    }
                }),
                None,
            )
            .await
            .unwrap();
        let ReadResult::Hit { data } = engine
            .read_query_with_entity_resolvers(
                None,
                DIRECT_EMAIL_QUERY,
                Some("EmailThread"),
                &variables,
                &[resolver()],
            )
            .await
            .unwrap()
        else {
            panic!("expected resolver hit")
        };
        assert_eq!(data["viewer"]["thread"]["id"], json!("thread-1"));

        engine
            .write_query(
                None,
                DIRECT_EMAIL_QUERY,
                Some("EmailThread"),
                &variables,
                &json!({ "viewer": { "id": "user-1", "thread": null } }),
                None,
            )
            .await
            .unwrap();
        let ReadResult::Hit { data } = engine
            .read_query_with_entity_resolvers(
                None,
                DIRECT_EMAIL_QUERY,
                Some("EmailThread"),
                &variables,
                &[resolver()],
            )
            .await
            .unwrap()
        else {
            panic!("expected resolver to override null")
        };
        assert_eq!(data["viewer"]["thread"]["id"], json!("thread-1"));
    });
}

#[test]
fn network_write_registers_matching_synthetic_dependencies_without_a_read() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let variables = direct_variables(json!("thread-1"));
        let resolvers = [resolver()];
        engine
            .write_query_with_registration(
                Some(41),
                Some(QueryRegistration {
                    op_id: 41,
                    entity_resolvers: &resolvers,
                }),
                NetworkWrite {
                    query: DIRECT_EMAIL_QUERY,
                    operation_name: Some("EmailThread"),
                    variables: &variables,
                    data: &json!({
                        "viewer": {
                            "id": "user-1",
                            "thread": {
                                "__typename": "GraphqlSoupEmailThread",
                                "id": "thread-1",
                                "emailName": "Before",
                                "ownerId": "user-1"
                            }
                        }
                    }),
                    identity: None,
                },
            )
            .await
            .unwrap();

        let update_variables = object(json!({ "input": { "threadId": "thread-1" } }));
        let write = engine
            .write_query(
                Some(2),
                UPDATE_EMAIL_MUTATION,
                Some("UpdateEmail"),
                &update_variables,
                &json!({
                    "markEmailThreadSeen": {
                        "__typename": "GraphqlSoupEmailThread",
                        "id": "thread-1",
                        "name": "After",
                        "ownerId": "user-1"
                    }
                }),
                None,
            )
            .await
            .unwrap();
        assert_eq!(write.affected_ops, [41].into());
    });
}

#[test]
fn synthetic_target_dependencies_are_registered_on_hits_and_misses() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed_thread(&mut engine, json!("thread-1"), "Before").await;
        let variables = direct_variables(json!("thread-1"));
        assert!(matches!(
            engine
                .read_query_with_entity_resolvers(
                    Some(41),
                    DIRECT_EMAIL_QUERY,
                    Some("EmailThread"),
                    &variables,
                    &[resolver()],
                )
                .await
                .unwrap(),
            ReadResult::Hit { .. }
        ));

        let update_variables = object(json!({ "input": { "threadId": "thread-1" } }));
        let write = engine
            .write_query(
                Some(2),
                UPDATE_EMAIL_MUTATION,
                Some("UpdateEmail"),
                &update_variables,
                &json!({
                    "markEmailThreadSeen": {
                        "__typename": "GraphqlSoupEmailThread",
                        "id": "thread-1",
                        "name": "After",
                        "ownerId": "user-1"
                    }
                }),
                None,
            )
            .await
            .unwrap();
        assert!(write.affected_ops.contains(&41));

        let target_key = EntityKey::entity("GraphqlSoupEmailThread", &["thread-1"]);
        let affected = engine.delete_keys(&[target_key]).await.unwrap();
        assert!(affected.contains(&41));
        assert!(matches!(
            engine
                .read_query_with_entity_resolvers(
                    Some(41),
                    DIRECT_EMAIL_QUERY,
                    Some("EmailThread"),
                    &variables,
                    &[resolver()],
                )
                .await
                .unwrap(),
            ReadResult::Miss
        ));

        assert!(matches!(
            engine
                .read_query_with_entity_resolvers(
                    Some(42),
                    DIRECT_EMAIL_QUERY,
                    Some("EmailThread"),
                    &direct_variables(json!("arrives-later")),
                    &[resolver()],
                )
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        let arrival_variables = object(json!({ "input": { "threadId": "arrives-later" } }));
        let arrival = engine
            .write_query(
                Some(2),
                UPDATE_EMAIL_MUTATION,
                Some("UpdateEmail"),
                &arrival_variables,
                &json!({
                    "markEmailThreadSeen": {
                        "__typename": "GraphqlSoupEmailThread",
                        "id": "arrives-later",
                        "name": "Arrived",
                        "ownerId": "user-1"
                    }
                }),
                None,
            )
            .await
            .unwrap();
        assert!(arrival.affected_ops.contains(&42));
    });
}

#[test]
fn rejects_invalid_untrusted_descriptors() {
    block_on(async {
        let valid_query = "query Viewer { user { id } }";
        let invalid = [
            EntityResolver {
                parent_type: "NoSuchParent".into(),
                ..resolver()
            },
            EntityResolver {
                parent_type: "GraphqlSoupEntity".into(),
                field_name: "metadata".into(),
                ..resolver()
            },
            EntityResolver {
                field_name: "noSuchField".into(),
                ..resolver()
            },
            EntityResolver {
                field_name: "id".into(),
                ..resolver()
            },
            EntityResolver {
                target_type: "NoSuchTarget".into(),
                ..resolver()
            },
            EntityResolver {
                target_type: "GraphqlSoupEntity".into(),
                ..resolver()
            },
            EntityResolver {
                target_type: "SoupPage".into(),
                ..resolver()
            },
            EntityResolver {
                target_type: "GraphqlSoupDocument".into(),
                ..resolver()
            },
            EntityResolver {
                argument_path: Vec::new(),
                ..resolver()
            },
        ];

        for descriptor in invalid {
            let error = engine_read_error(valid_query, &[descriptor]).await;
            assert!(
                error.contains("entity resolver"),
                "unexpected error: {error}"
            );
        }
        let error = engine_read_error(valid_query, &[resolver(), resolver()]).await;
        assert!(error.contains("duplicate entity resolver"));
    });
}

async fn engine_read_error(query: &str, resolvers: &[EntityResolver]) -> String {
    Engine::new(InMemoryStorage::new())
        .read_query_with_entity_resolvers(
            None,
            query,
            Some("Viewer"),
            &serde_json::Map::new(),
            resolvers,
        )
        .await
        .expect_err("descriptor must be rejected")
        .to_string()
}
