use super::*;
use crate::store::InMemoryStorage;

#[test]
fn resolved_read_plans_do_not_leak_arguments_or_values_between_reads() {
    pollster::block_on(async {
        let query = "query Page($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name } } nextCursor } } }";
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        let variables = |limit| {
            serde_json::json!({"input": {"limit": limit}})
                .as_object()
                .unwrap()
                .clone()
        };
        let response = |id: &str, name: &str| {
            serde_json::json!({"user": {"id": "viewer", "soup": {
                "items": [{"__typename": "GraphqlSoupDocument", "id": id, "name": name}], "nextCursor": null
            }}})
        };
        for (limit, id, name) in [(1, "first", "First"), (2, "second", "Second")] {
            engine
                .write_query(
                    None,
                    query,
                    Some("Page"),
                    &variables(limit),
                    &response(id, name),
                    None,
                )
                .await
                .unwrap();
        }
        for (limit, id, name) in [
            (1, "first", "First"),
            (2, "second", "Second"),
            (1, "first", "First"),
        ] {
            let read = engine
                .read_query(Some(1), query, Some("Page"), &variables(limit))
                .await
                .unwrap();
            assert!(matches!(read, ReadResult::Hit { data } if data == response(id, name)));
        }
        engine
            .write_query(
                None,
                query,
                Some("Page"),
                &variables(1),
                &response("first", "Renamed"),
                None,
            )
            .await
            .unwrap();
        let read = engine
            .read_query(Some(1), query, Some("Page"), &variables(1))
            .await
            .unwrap();
        assert!(matches!(read, ReadResult::Hit { data } if data == response("first", "Renamed")));
        let read = engine
            .read_query(Some(1), query, Some("Page"), &variables(2))
            .await
            .unwrap();
        assert!(matches!(read, ReadResult::Hit { data } if data == response("second", "Second")));
    });
}

#[test]
fn ordinary_network_refresh_loads_each_cold_batch_only_once() {
    pollster::block_on(async {
        let query = "query Page { user { id soup(input: {limit: 50}) { items { __typename id ... on GraphqlSoupDocument { name } } nextCursor } } }";
        let data = serde_json::json!({"user": {"id": "viewer", "soup": {
            "items": (0..12).map(|id| serde_json::json!({
                "__typename": "GraphqlSoupDocument", "id": id.to_string(), "name": "Cached"
            })).collect::<Vec<_>>(), "nextCursor": null
        }}});
        let variables = serde_json::Map::new();
        let mut original = Engine::new(InMemoryStorage::new());
        original
            .write_query(None, query, Some("Page"), &variables, &data, None)
            .await
            .unwrap();
        let storage = original.into_storage();
        let before = storage.record_get_count();
        let mut reopened = Engine::with_capacity(storage, 1);
        let result = reopened
            .write_query(None, query, Some("Page"), &variables, &data, None)
            .await
            .unwrap();
        assert!(result.changed.is_empty());
        assert!(!result.revision_advanced);
        assert_eq!(reopened.storage().record_get_count() - before, 1);
        assert!(
            matches!(reopened.read_query(None, query, Some("Page"), &variables).await.unwrap(), ReadResult::Hit { data: read } if read == data)
        );
    });
}

#[test]
fn revision_overflow_is_rejected_without_mutating_storage() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine.revision = u64::MAX.to_string().parse().unwrap();

        let result = engine.clear().await;
        assert!(matches!(result, Err(EngineError::RevisionOverflow)));
        assert_eq!(engine.current_revision().to_string(), u64::MAX.to_string());
        assert!(engine.storage().is_empty());
    });
}

#[test]
fn parsed_documents_are_bounded_reused_and_errors_are_not_cached() {
    let mut engine = Engine::new(InMemoryStorage::new());
    let query = |index| format!("query Q{index} {{ user {{ id }} }}");
    for index in 0..DOCUMENT_CACHE_CAPACITY {
        Engine::<InMemoryStorage>::document(&mut engine.docs, &query(index)).unwrap();
    }
    Engine::<InMemoryStorage>::document(&mut engine.docs, &query(0)).unwrap();
    Engine::<InMemoryStorage>::document(&mut engine.docs, &query(DOCUMENT_CACHE_CAPACITY)).unwrap();
    assert_eq!(engine.docs.len(), DOCUMENT_CACHE_CAPACITY);
    assert!(engine.docs.contains(&query(0)));
    assert!(!engine.docs.contains(&query(1)));
    assert!(Engine::<InMemoryStorage>::document(&mut engine.docs, "query Broken {").is_err());
    assert_eq!(engine.docs.len(), DOCUMENT_CACHE_CAPACITY);
    let document = Engine::<InMemoryStorage>::document(&mut engine.docs, &query(1)).unwrap();
    assert!(document.operation(Some("Q1")).is_ok());
}

#[test]
fn fragment_reads_keep_hot_and_cold_linked_records_in_the_working_set() {
    use crate::value::CacheValue;
    pollster::block_on(async {
        for message_is_hot in [true, false] {
            let mut engine = Engine::with_capacity(InMemoryStorage::new(), 3);
            let message_key = EntityKey("GraphqlSoupEmailMessage:message".into());
            let thread_key = EntityKey("GraphqlSoupEmailThread:thread".into());
            let unrelated_key = EntityKey("GraphqlSoupDocument:unrelated".into());
            let message = Record {
                fields: [
                    (
                        "__typename".into(),
                        CacheValue::String("GraphqlSoupEmailMessage".into()),
                    ),
                    ("id".into(), CacheValue::String("message".into())),
                    ("subject".into(), CacheValue::String("Subject".into())),
                    (
                        "bodyText".into(),
                        CacheValue::String("unselected body".repeat(4096)),
                    ),
                ]
                .into(),
            };
            let thread = Record {
                fields: [
                    (
                        "__typename".into(),
                        CacheValue::String("GraphqlSoupEmailThread".into()),
                    ),
                    ("id".into(), CacheValue::String("thread".into())),
                    (
                        crate::value::field_key("messages", Some(r#"{"limit":1,"offset":0}"#)),
                        CacheValue::List(vec![CacheValue::Ref(message_key.clone())]),
                    ),
                ]
                .into(),
            };
            engine
                .storage
                .put_batch(vec![(message_key.clone(), message.clone())])
                .await
                .unwrap();
            if message_is_hot {
                engine.hot.put(message_key.clone(), message);
            }
            engine.hot.put(thread_key.clone(), thread);
            engine.hot.put(unrelated_key.clone(), Record::default());
            if !message_is_hot {
                engine.hot.put(
                    EntityKey("GraphqlSoupDocument:other".into()),
                    Record::default(),
                );
            }
            let selection = RecordSelection::parse(
            "fragment Thread on GraphqlSoupEmailThread { id messages(offset: 0, limit: 1) { id subject } }",
            "Thread",
        ).unwrap();
            let reads = engine.storage().record_get_count();
            for _ in 0..2 {
                let result = engine
                    .read_records_by_keys(&selection, std::slice::from_ref(&thread_key))
                    .await
                    .unwrap();
                assert_eq!(
                    result.value[0].record,
                    serde_json::json!({"id": "thread", "messages": [{"id": "message", "subject": "Subject"}]})
                );
            }
            assert_eq!(
                engine.storage().record_get_count(),
                reads + usize::from(!message_is_hot)
            );
            engine.hot.put(
                EntityKey("GraphqlSoupDocument:new".into()),
                Record::default(),
            );
            assert!(engine.hot.contains(&thread_key));
            assert!(engine.hot.contains(&message_key));
            assert!(!engine.hot.contains(&unrelated_key));
        }
    });
}

#[test]
fn opaque_json_numbers_round_trip_exactly_through_hot_and_cold_reads() {
    pollster::block_on(async {
        let query = "query Payload { user { id activity(input: {limit: 1}) { items { __typename id action { __typename ... on GraphqlActivityUnknownAction { payload } } } } } }";
        let data = serde_json::json!({"user": {"id": "viewer", "activity": {"items": [{
            "__typename": "GraphqlActivityEvent", "id": "event", "action": {
                "__typename": "GraphqlActivityUnknownAction", "payload": {
                    "large": 15_588_948_318_755_801_000.0,
                    "negative": -15_588_948_318_755_801_000.0,
                    "fraction": 1.0000000000000002,
                    "tiny": 1.2345678901234567e-200
                }
            }
        }]}}});
        let variables = serde_json::Map::new();
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, query, Some("Payload"), &variables, &data, None)
            .await
            .unwrap();
        for _ in 0..2 {
            let read = engine
                .read_query(None, query, Some("Payload"), &variables)
                .await
                .unwrap();
            assert!(matches!(read, ReadResult::Hit { data: actual } if actual == data));
            engine = Engine::new(engine.into_storage());
        }
    });
}
