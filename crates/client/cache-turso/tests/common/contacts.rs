use cache_core::engine::Engine;
use cache_core::record_selection::RecordSelection;
use cache_core::search::{QUICK_ACCESS_PROJECTION_VERSION, SearchProfile, SearchRequest};
use cache_core::store::Storage;
use cache_core::value::EntityKey;
use serde_json::{Value, json};

// Exercise the actual client operation and fragment, not a parallel wire shape.
const DOCUMENT: &str = include_str!(
    "../../../../../apps/web/src/lib/service-clients/service-storage/graphql/contacts.graphql"
);
const VIEWER: &str = "macro|viewer@example.com";
const PAGE_SIZE: usize = 500;

/// Persist bounded pages without retaining a directory-sized fixture in the test.
pub async fn hydrate_contacts<S: Storage>(engine: &mut Engine<S>, pages: usize) {
    for page in 0..pages {
        let nodes: Vec<_> = (page * PAGE_SIZE..(page + 1) * PAGE_SIZE)
            .map(|index| {
                json!({
                    "id": format!("contact-{index:06}"),
                    "userId": format!("macro|user{index:06}@example.com"),
                    "email": format!("user{index:06}@example.com"),
                    "name": if index % 2 == 0 { Some(format!("Person {index:06}")) } else { None },
                })
            })
            .collect();
        let after =
            (page > 0).then(|| format!("macro|user{:06}@example.com", page * PAGE_SIZE - 1));
        let next = (page + 1 < pages)
            .then(|| format!("macro|user{:06}@example.com", (page + 1) * PAGE_SIZE - 1));
        let variables = json!({"limit": PAGE_SIZE, "after": after});
        let data =
            json!({"user": {"id": VIEWER, "contacts": {"nodes": nodes, "nextCursor": next}}});
        let result = engine
            .hydrate_query(
                DOCUMENT,
                Some("ContactDirectoryBackfill"),
                variables.as_object().unwrap(),
                &data,
                Some(VIEWER),
            )
            .await
            .unwrap();
        assert_eq!(
            result.data,
            Some(json!({"user": {"id": VIEWER, "contacts": {"nextCursor": next}}}))
        );
        assert_eq!(
            result.search_changed_buckets,
            std::collections::BTreeSet::from(["person".to_owned()])
        );
        let viewer = engine
            .storage()
            .get_batch(&[EntityKey::entity("GraphqlUser", &[VIEWER])])
            .await
            .unwrap()
            .remove(0)
            .unwrap();
        assert!(
            viewer
                .fields
                .keys()
                .all(|field| !field.starts_with("contacts"))
        );
        assert!(cache_core::codec::encode_record(&viewer).len() < 256);
    }
}

/// Search materializes only its bounded winning window, with target IDs intact.
pub async fn assert_contact_search<S: Storage>(engine: &mut Engine<S>, total: usize) {
    let selection = RecordSelection::parse(
        &engine.schema_snapshot(),
        DOCUMENT,
        "ContactDirectoryFields",
    )
    .unwrap();
    let last_email = format!("user{:06}@example.com", total - 1);
    for query in [
        "Person".to_owned(),
        last_email.clone(),
        "missing".into(),
        String::new(),
    ] {
        let mut request = SearchRequest {
            profile: SearchProfile::QuickAccessV1,
            buckets: vec!["person".into()],
            query: query.clone(),
            cursor: None,
            limit: 7,
            now_ms: 0,
        };
        let page = engine.search(&request).await.unwrap();
        assert_eq!(page.projection_version, QUICK_ACCESS_PROJECTION_VERSION);
        assert!(page.documents.len() <= request.limit);
        let keys: Vec<_> = page
            .documents
            .iter()
            .map(|doc| doc.record_key.clone())
            .collect();
        let selected = engine
            .read_records_by_keys(&selection, &keys)
            .await
            .unwrap();
        assert_eq!(selected.value.len(), keys.len());
        for selected in &selected.value {
            assert!(
                selected
                    .record_key
                    .as_ref()
                    .starts_with("GraphqlContact:contact-")
            );
            assert_ne!(selected.record["id"], selected.record["userId"]);
            assert_eq!(
                selected.record["userId"],
                format!("macro|{}", selected.record["email"].as_str().unwrap())
            );
        }
        if query == last_email {
            assert_eq!(selected.value.len(), 1);
            assert_eq!(selected.value[0].record["email"], last_email);
            assert_eq!(selected.value[0].record["name"], Value::Null);
        } else if query == "missing" {
            assert!(selected.value.is_empty());
        } else {
            assert_eq!(selected.value.len(), 7);
        }
        if query.is_empty() {
            request.cursor = page.next_cursor;
            assert!(request.cursor.is_some());
            let second = engine.search(&request).await.unwrap();
            assert_eq!(second.documents.len(), 7);
            assert!(
                second
                    .documents
                    .iter()
                    .all(|doc| !keys.contains(&doc.record_key))
            );
        }
    }
}

pub async fn assert_account_reset<S: Storage>(engine: &mut Engine<S>) {
    let old_generation = engine.current_storage_generation().await.unwrap();
    let viewer = "macro|other@example.com";
    let data = json!({"user": {"id": viewer, "contacts": {"nodes": [{"id": "other-contact", "userId": "macro|other@example.com", "email": "other@example.com", "name": "Other"}], "nextCursor": null}}});
    engine
        .hydrate_query(
            DOCUMENT,
            Some("ContactDirectoryBackfill"),
            json!({"limit": PAGE_SIZE, "after": null})
                .as_object()
                .unwrap(),
            &data,
            Some(viewer),
        )
        .await
        .unwrap();
    assert_ne!(
        engine.current_storage_generation().await.unwrap(),
        old_generation
    );
    let result = engine
        .search(&SearchRequest {
            profile: SearchProfile::QuickAccessV1,
            buckets: vec!["person".into()],
            query: String::new(),
            cursor: None,
            limit: 500,
            now_ms: 0,
        })
        .await
        .unwrap();
    assert_eq!(result.documents.len(), 1);
    assert_eq!(
        result.documents[0].record_key.as_ref(),
        "GraphqlContact:other-contact"
    );
    assert!(
        engine
            .storage()
            .get_batch(&[EntityKey::entity("GraphqlContact", &["contact-000000"])])
            .await
            .unwrap()[0]
            .is_none()
    );
}
