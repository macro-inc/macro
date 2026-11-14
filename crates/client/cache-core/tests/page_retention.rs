//! Hydration must not accumulate query entry points or change offline intents.
use cache_core::engine::{Engine, ReadResult};
use cache_core::page_retention::{MAX_CHANNEL_PAGES, MAX_SOUP_PAGE_BYTES, MAX_SOUP_PAGES};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey};
use pollster::block_on;
use serde_json::{Value, json};

const QUERY: &str = "query Page($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name } } nextCursor } } }";
fn variables(cursor: usize) -> serde_json::Map<String, Value> {
    json!({"input":{"continuation":{"cursor":cursor.to_string()}}})
        .as_object()
        .unwrap()
        .clone()
}
fn data(n: usize) -> Value {
    json!({"user":{"id":"viewer","soup":{"items":[{"__typename":"GraphqlSoupDocument","id":format!("doc-{n}"),"name":"hydrated"}],"nextCursor":"next"}}})
}

#[test]
fn thousands_of_hydrated_pages_do_not_grow_viewer_or_replace_foreground_membership() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                QUERY,
                Some("Page"),
                &variables(0),
                &data(0),
                Some("viewer"),
            )
            .await
            .unwrap();
        let before = engine
            .storage()
            .get_batch(&[EntityKey("GraphqlUser:viewer".into())])
            .await
            .unwrap();
        let generation = engine.current_storage_generation().await.unwrap();
        for n in 1..2000 {
            let result = engine
                .hydrate_query(QUERY, Some("Page"), &variables(n), &data(n), Some("viewer"))
                .await
                .unwrap();
            assert!(
                !result
                    .write_result
                    .changed
                    .contains(&EntityKey("GraphqlUser:viewer".into()))
            );
        }
        assert_eq!(
            engine
                .storage()
                .get_batch(&[EntityKey("GraphqlUser:viewer".into())])
                .await
                .unwrap(),
            before
        );
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            generation
        );
        assert!(matches!(
            engine
                .read_query(None, QUERY, Some("Page"), &variables(0))
                .await
                .unwrap(),
            ReadResult::Hit { .. }
        ));
        assert!(matches!(
            engine
                .read_query(None, QUERY, Some("Page"), &variables(1999))
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        assert!(
            engine
                .storage()
                .get_batch(&[EntityKey("GraphqlSoupDocument:doc-1999".into())])
                .await
                .unwrap()[0]
                .is_some()
        );
    });
}

#[test]
fn foreground_page_eviction_keeps_entities_and_makes_evicted_queries_miss() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        for n in 0..MAX_SOUP_PAGES + 10 {
            engine
                .write_query(None, QUERY, Some("Page"), &variables(n), &data(n), None)
                .await
                .unwrap();
        }
        let mut reopened = Engine::new(engine.into_storage());
        assert!(matches!(
            reopened
                .read_query(None, QUERY, Some("Page"), &variables(0))
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        assert!(matches!(
            reopened
                .read_query(None, QUERY, Some("Page"), &variables(MAX_SOUP_PAGES + 9))
                .await
                .unwrap(),
            ReadResult::Hit { .. }
        ));
        let records = reopened
            .storage()
            .get_batch(&[
                EntityKey("GraphqlUser:viewer".into()),
                EntityKey("GraphqlSoupDocument:doc-0".into()),
            ])
            .await
            .unwrap();
        assert!(
            cache_core::codec::encode_record(records[0].as_ref().unwrap()).len()
                < MAX_SOUP_PAGE_BYTES
        );
        assert_eq!(
            records[1].as_ref().unwrap().fields["name"],
            CacheValue::String("hydrated".into())
        );
    });
}

#[test]
fn capped_database_read_remains_available_after_reopen() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let query = "query Rows($input: SoupInput!) { user { id soup(input: $input) { items { __typename id } nextCursor } } }";
        // Forty full 500-row pages plus the terminal page. Real Soup cursors
        // also carry the filter, so include that overhead in the fixture.
        let page_variables = |page: usize| {
            json!({"input":{"continuation":{"cursor":format!("{page}:{}", "x".repeat(2048))}}})
                .as_object()
                .unwrap()
                .clone()
        };
        for page in 0..=40 {
            let items: Vec<Value> = if page == 40 {
                Vec::new()
            } else {
                (0..500)
                    .map(|row| {
                        json!({
                            "__typename":"GraphqlSoupDatabaseRow",
                            "id":format!("00000000-0000-7000-8000-{:012}", page * 500 + row)
                        })
                    })
                    .collect()
            };
            let data = json!({"user":{"id":"viewer","soup":{
                "items":items,
                "nextCursor":if page == 40 { None } else { Some(format!("{}:{}", page + 1, "x".repeat(2048))) }
            }}});
            engine
                .write_query(
                    None,
                    query,
                    Some("Rows"),
                    &page_variables(page),
                    &data,
                    None,
                )
                .await
                .unwrap();
        }
        let mut reopened = Engine::new(engine.into_storage());
        for page in [0, 19, 39, 40] {
            let result = reopened
                .read_query(None, query, Some("Rows"), &page_variables(page))
                .await
                .unwrap();
            let ReadResult::Hit { data, .. } = result else {
                panic!("database page {page} was evicted");
            };
            assert_eq!(
                data["user"]["soup"]["items"].as_array().unwrap().len(),
                if page == 40 { 0 } else { 500 }
            );
        }
    });
}

const CHANNEL_QUERY: &str = "query Timeline($channelId: ID!) { user { id channelMessages(channelId: $channelId) { id timeline(input: null) { seq entries { __typename ... on GraphqlChannelMessage { id } } olderCursor { __typename } newerCursor { __typename } } } } }";
fn channel_id(n: usize) -> String {
    format!("00000000-0000-7000-8000-{n:012}")
}
fn channel_variables(n: usize) -> serde_json::Map<String, Value> {
    json!({"channelId":channel_id(n)})
        .as_object()
        .unwrap()
        .clone()
}
fn channel_data(n: usize) -> Value {
    json!({"user":{"id":"viewer","channelMessages":{"id":channel_id(n),"timeline":{
        "seq":1,
        "entries":[{"__typename":"GraphqlChannelMessage","id":format!("message-{n}")}],
        "olderCursor":null,
        "newerCursor":null
    }}}})
}

#[test]
fn channel_pages_beyond_the_bound_miss_without_evicting_soup_pages() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, QUERY, Some("Page"), &variables(0), &data(0), None)
            .await
            .unwrap();
        for n in 0..MAX_CHANNEL_PAGES + 10 {
            engine
                .write_query(
                    None,
                    CHANNEL_QUERY,
                    Some("Timeline"),
                    &channel_variables(n),
                    &channel_data(n),
                    None,
                )
                .await
                .unwrap();
        }
        let mut reopened = Engine::new(engine.into_storage());
        let read = |n: usize| channel_variables(n);
        assert!(matches!(
            reopened
                .read_query(None, CHANNEL_QUERY, Some("Timeline"), &read(0))
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        assert!(matches!(
            reopened
                .read_query(
                    None,
                    CHANNEL_QUERY,
                    Some("Timeline"),
                    &read(MAX_CHANNEL_PAGES + 9)
                )
                .await
                .unwrap(),
            ReadResult::Hit { .. }
        ));
        assert!(matches!(
            reopened
                .read_query(None, QUERY, Some("Page"), &variables(0))
                .await
                .unwrap(),
            ReadResult::Hit { .. }
        ));
        // Only the viewer's link goes; the channel's records are the client's
        // to delete, by key.
        let channel = format!("GraphqlChannelMessages:{}", channel_id(0));
        assert!(
            reopened
                .storage()
                .get_batch(&[
                    EntityKey(channel.into()),
                    EntityKey("GraphqlChannelMessage:message-0".into()),
                ])
                .await
                .unwrap()
                .iter()
                .all(Option::is_some)
        );
    });
}
