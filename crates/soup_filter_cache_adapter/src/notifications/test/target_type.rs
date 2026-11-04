//! Notification type selections the web client has shipped. The cache stores
//! selected fields by schema name, so an aliased `entityType: targetEntityType`
//! arrives as `targetEntityType`.

use super::*;

const WEB_GRAPHQL: &str = include_str!(
    "../../../../../apps/web/src/lib/service-clients/service-storage/graphql/soup.graphql"
);

fn web_state_fragment() -> &'static str {
    let start = WEB_GRAPHQL
        .find("fragment SoupNotificationStateFields on GraphqlNotification")
        .expect("soup.graphql defines SoupNotificationStateFields");
    let end = start
        + WEB_GRAPHQL[start..]
            .find("\n}")
            .expect("fragment is closed")
        + "\n}".len();
    &WEB_GRAPHQL[start..end]
}

fn backfill_query(notification_selection: &str, fragments: &str) -> String {
    format!(
        "query SoupBackfill {{ user {{ id soup(input: {{ initial: {{ limit: 20 }} }}) {{ items {{ __typename id cacheProjection notifications {{ {notification_selection} }} ... on GraphqlSoupDocument {{ ownerId projectId fileType subType {{ __typename }} createdAt updatedAt }} }} }} }} }}\n{fragments}"
    )
}

/// Every selection the web client has used for the notification type.
fn selections() -> Vec<(&'static str, String)> {
    vec![
        (
            "web SoupNotificationStateFields",
            backfill_query("...SoupNotificationStateFields", web_state_fragment()),
        ),
        (
            "aliased targetEntityType",
            backfill_query("id entityId entityType: targetEntityType state", ""),
        ),
        (
            "targetEntityType",
            backfill_query("id entityId targetEntityType state", ""),
        ),
        (
            "legacy entityType",
            backfill_query("id entityId entityType state", ""),
        ),
    ]
}

/// A full web-shaped row. `entityType` is both the legacy field and the alias
/// response key, so one row answers every selection above.
fn web_notification(id: &str, state: &str) -> Value {
    json!({
        "__typename": "GraphqlNotification",
        "id": id,
        "eventType": "document_mention",
        "entityType": "DOCUMENT",
        "targetEntityType": "DOCUMENT",
        "entityId": D,
        "sent": true,
        "state": state,
        "createdAt": "2025-01-01T00:00:00Z",
        "viewedAt": null,
        "updatedAt": "2025-01-01T00:00:00Z",
        "senderId": "macro|sender@example.com",
    })
}

#[test]
fn web_notification_selection_completes_backfill_pages() {
    for (name, query) in selections() {
        let mutations = authoritative_projection_mutations(
            cache_core::meta::bundled_schema_ref(),
            &query,
            Some("SoupBackfill"),
            &snapshot(vec![web_notification(A, "UNSEEN")]),
        )
        .unwrap_or_else(|error| panic!("{name}: {error:?}"));
        let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
            panic!("{name}: complete projection, got {mutations:?}");
        };
        assert!(document.matches(&unseen()), "{name}");
        assert!(!document.matches(&seen()), "{name}");
    }
}

#[test]
fn canonical_type_wins_over_the_soup_fallback() {
    // `entityType` maps types outside Soup to DOCUMENT; the canonical type
    // keeps an external chat from counting toward a document.
    let mut external = web_notification(A, "UNSEEN");
    external["targetEntityType"] = json!("EXTERNAL_CHAT");
    let query = backfill_query("id entityId entityType targetEntityType state", "");
    let mutations = authoritative_projection_mutations(
        cache_core::meta::bundled_schema_ref(),
        &query,
        Some("SoupBackfill"),
        &snapshot(vec![external]),
    )
    .unwrap();
    let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
        panic!("complete projection, got {mutations:?}");
    };
    assert!(!document.matches(&unseen()));
}

async fn seen_and_done_reach_the_parent<S: PredicateIndexStorage>(storage: S, query: &str) {
    let mut engine = Engine::new(storage);
    write(
        &mut engine,
        query,
        &snapshot(vec![
            web_notification(A, "UNSEEN"),
            web_notification(B, "UNSEEN"),
        ]),
    )
    .await;
    assert!(matches(&mut engine, unseen()).await);

    // Seen/done responses carry only identity and state; the parent comes
    // from the cached notification record.
    let data = json!({"updateNotifications":[{"__typename":"GraphqlNotification", "id":A, "state":"SEEN"}]});
    let updates = notification_projection_updates(
        cache_core::meta::bundled_schema_ref(),
        engine.storage(),
        UPDATE,
        None,
        &variables(),
        &data,
    )
    .await
    .unwrap();
    assert_eq!(updates.len(), 1, "seen reaches the parent");
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query: UPDATE,
                operation_name: None,
                variables: &variables(),
                data: &data,
                identity: Some("viewer"),
            },
            updates,
        )
        .await
        .unwrap();
    assert!(matches(&mut engine, seen()).await);
    assert!(matches(&mut engine, unseen()).await);

    mark_done(&mut engine, B, "00000000-0000-0000-0000-000000000101").await;
    assert!(!matches(&mut engine, unseen()).await);
    assert!(matches(&mut engine, seen()).await);
}

#[test]
fn seen_and_done_reach_the_parent_for_every_selection() {
    for (name, query) in selections() {
        println!("{name}");
        pollster::block_on(seen_and_done_reach_the_parent(
            InMemoryStorage::new(),
            &query,
        ));
    }
}

#[test]
fn seen_and_done_reach_the_parent_real_turso() {
    let query = backfill_query("...SoupNotificationStateFields", web_state_fragment());
    pollster::block_on(async {
        seen_and_done_reach_the_parent(
            cache_turso::TursoStorage::open_in_memory("notification-target-type").unwrap(),
            &query,
        )
        .await
    });
}
