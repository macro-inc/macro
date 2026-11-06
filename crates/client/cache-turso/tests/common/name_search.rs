use cache_core::{
    engine::{Engine, HydrationScope},
    people::{
        ContextAction, ContextUpdate, PeopleMode, PeopleSearch, PeopleSearchResult,
        name_search::reader::NameSearchRead,
    },
    search::SearchQuery,
    store::Storage,
};
use uuid::Uuid;

/// Same core/adapter path over native storage and browser OPFS; compare with a
/// complete streaming reference without constructing a directory result array.
pub async fn contract<S: Storage>(engine: &mut Engine<S>, scope: &HydrationScope) {
    let epoch = Uuid::from_u128(81);
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Begin {
                previous_epoch: None,
            },
        })
        .await
        .unwrap();
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Commit,
        })
        .await
        .unwrap();
    for query in ["group1", "gr", "oup", "LATE_ÉCHO%", "unknown"] {
        let mut request = PeopleSearch {
            scope: scope.clone(),
            mode: PeopleMode::Recipient,
            query: query.into(),
            excluded: vec![],
            sender_domain: None,
            limit: 7,
            now_ms: 0,
            cursor: None,
        };
        for _ in 0..3 {
            let mut expected =
                NameSearchRead::new(&request, epoch, engine.people_read_version()).unwrap();
            engine
                .storage()
                .visit_contact_records(&SearchQuery::new(""), |k, r| expected.push(k, r, None))
                .await
                .unwrap();
            let expected = expected.finish().unwrap();
            let actual = engine.search_people_named(&request).await.unwrap();
            assert_eq!(
                serde_json::to_value(&actual).unwrap(),
                serde_json::to_value(expected).unwrap(),
                "{query}"
            );
            let PeopleSearchResult::Page { next_cursor, .. } = actual else {
                panic!("page");
            };
            if next_cursor.is_none() {
                break;
            }
            request.cursor = next_cursor;
        }
    }
    let mut request = PeopleSearch {
        scope: scope.clone(),
        mode: PeopleMode::Recipient,
        query: "gr".into(),
        excluded: vec![],
        sender_domain: None,
        limit: 1,
        now_ms: 0,
        cursor: None,
    };
    let PeopleSearchResult::Page { next_cursor, .. } =
        engine.search_people_named(&request).await.unwrap()
    else {
        panic!("page");
    };
    assert!(next_cursor.is_some());
    request.cursor = next_cursor;
    let version = engine.people_read_version();
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Commit,
        })
        .await
        .unwrap();
    engine
        .invalidate_keys([&cache_core::value::EntityKey::entity(
            "Document",
            &["unrelated"],
        )])
        .unwrap();
    assert_eq!(version, engine.people_read_version());
    engine.search_people_named(&request).await.unwrap();
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Patch {
                updates: vec![cache_core::people::PersonFactPatch {
                    user_id: "macro|p000001@example.com".try_into().unwrap(),
                    facts: cache_core::people::PersonFacts {
                        last_interaction_ms: Some(100),
                        ..Default::default()
                    },
                }],
            },
        })
        .await
        .unwrap();
    assert_ne!(version, engine.people_read_version());
    assert!(engine.search_people_named(&request).await.is_err());
    engine.clear().await.unwrap();
    assert!(
        engine
            .search_people_named(&PeopleSearch {
                scope: scope.clone(),
                mode: PeopleMode::Recipient,
                query: String::new(),
                excluded: vec![],
                sender_domain: None,
                limit: 1,
                now_ms: 0,
                cursor: None
            })
            .await
            .is_err()
    );
}
