//! The web stores `GraphqlContact.lists` through its ordinary contact reads.
//! Native binaries take their schema from the web bundle's SDL, so a binary
//! built before the field existed stores it the same way once a bundle
//! selects it.

use cache_core::engine::{Engine, HydrationScope, NetworkWrite};
use cache_core::meta::{BUNDLED_SCHEMA_SDL, Schema};
use cache_core::people::sync::ContactSnapshotRequest;
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey};
use pollster::block_on;
use serde_json::json;
use uuid::Uuid;

const VIEWER: &str = "macro|viewer@example.com";
const PERSON: &str = "macro|person@example.com";

// The documents the web prints for `ContactDirectoryBackfillWithLists` and
// `ContactDirectoryByUserIds` (apps/web/.../graphql/contacts.graphql).
const BACKFILL_WITH_LISTS: &str = "query ContactDirectoryBackfillWithLists($limit: Int, $after: String) {\n  user {\n    id\n    contacts(limit: $limit, after: $after) {\n      nodes @cacheOnly {\n        ...ContactDirectoryListFields\n      }\n      nextCursor\n    }\n  }\n}\n\nfragment ContactDirectoryFields on GraphqlContact {\n  id\n  userId\n  email\n  name\n}\n\nfragment ContactDirectoryListFields on GraphqlContact {\n  ...ContactDirectoryFields\n  lists\n}";
const BY_USER_IDS: &str = "query ContactDirectoryByUserIds($userIds: [ID!]!) {\n  user {\n    id\n    contactsByUserIds(userIds: $userIds) {\n      ...ContactDirectoryFields\n    }\n  }\n}\n\nfragment ContactDirectoryFields on GraphqlContact {\n  id\n  userId\n  email\n  name\n}";

async fn fenced(engine: &mut Engine<InMemoryStorage>) -> HydrationScope {
    let mut scope = HydrationScope {
        identity: VIEWER.into(),
        storage_generation: engine.current_storage_generation().await.unwrap(),
        contact_fence: None,
    };
    scope.contact_fence = Some(
        engine
            .contact_snapshot(&ContactSnapshotRequest {
                scope: scope.clone(),
                scan: None,
            })
            .await
            .unwrap()
            .fence,
    );
    scope
}

async fn stored_lists(engine: &Engine<InMemoryStorage>, id: &str) -> Option<CacheValue> {
    engine
        .storage()
        .get_batch(&[EntityKey::entity("GraphqlContact", &[id])])
        .await
        .unwrap()[0]
        .as_ref()
        .and_then(|record| record.fields.get("lists").cloned())
}

#[test]
fn bundle_sdl_stores_contact_lists_and_a_plain_lookup_keeps_them() {
    block_on(async {
        let schema = Schema::from_sdl(BUNDLED_SCHEMA_SDL).unwrap();
        let mut engine = Engine::with_schema(InMemoryStorage::new(), 10, schema);
        let id = Uuid::new_v5(
            &Uuid::new_v5(&Uuid::NAMESPACE_OID, VIEWER.as_bytes()),
            PERSON.as_bytes(),
        )
        .to_string();
        let contact =
            json!({"id": id, "userId": PERSON, "email": "person@example.com", "name": "Person"});

        let mut listed = contact.clone();
        listed["lists"] = json!(["teammates", "gmail"]);
        let variables = json!({"limit": 500, "after": null});
        let data =
            json!({"user": {"id": VIEWER, "contacts": {"nodes": [listed], "nextCursor": null}}});
        let scope = fenced(&mut engine).await;
        engine
            .hydrate_query_in_scope(
                NetworkWrite {
                    query: BACKFILL_WITH_LISTS,
                    operation_name: Some("ContactDirectoryBackfillWithLists"),
                    variables: variables.as_object().unwrap(),
                    data: &data,
                    identity: Some(VIEWER),
                },
                &scope,
                vec![],
            )
            .await
            .unwrap();
        let expected = CacheValue::List(vec![
            CacheValue::String("teammates".into()),
            CacheValue::String("gmail".into()),
        ]);
        assert_eq!(stored_lists(&engine, &id).await, Some(expected.clone()));

        // An exact lookup that did not select lists (the flag off again, or
        // an older bundle) refreshes the other fields and keeps them.
        let variables = json!({"userIds": [PERSON]});
        let data = json!({"user": {"id": VIEWER, "contactsByUserIds": [contact]}});
        let scope = fenced(&mut engine).await;
        engine
            .hydrate_query_in_scope(
                NetworkWrite {
                    query: BY_USER_IDS,
                    operation_name: Some("ContactDirectoryByUserIds"),
                    variables: variables.as_object().unwrap(),
                    data: &data,
                    identity: Some(VIEWER),
                },
                &scope,
                vec![],
            )
            .await
            .unwrap();
        assert_eq!(stored_lists(&engine, &id).await, Some(expected));
    });
}
