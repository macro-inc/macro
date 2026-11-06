use super::*;
use strum::IntoEnumIterator;
#[path = "../../../../import_tracker/test_support.rs"]
mod support;

#[test]
fn every_request_is_a_fixed_query() {
    for read in LinearRead::iter() {
        let query = read.query();
        assert!(query.trim_start().starts_with("query "));
        assert!(!query.contains("mutation"));
        assert!(!query.contains("subscription"));
        assert!(query.contains("pageInfo { hasNextPage endCursor }"));
    }
}

#[tokio::test(start_paused = true)]
async fn cursors_are_followed_and_repeated_cursors_fail() {
    let proxy = Arc::new(support::Proxy::new(vec![
        json!({"data":{"users":{"nodes":[{"id":"u1","name":"A","email":null}],"pageInfo":{"hasNextPage":true,"endCursor":"next"}}}}),
        json!({"data":{"users":{"nodes":[{"id":"u2","name":"B","email":"b@example.com"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}),
        json!({"data":{"users":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}}),
        json!({"data":{"users":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}}),
    ]));
    let user = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let connections = Connections::new(
        Arc::new(support::Store),
        Some(proxy.clone()),
        "linear",
        Duration::ZERO,
    );
    let client = Client::new(connections.open(&user).await.unwrap());
    let users = client
        .all::<import_tracker::domain::model::User>(LinearRead::Users, None)
        .await
        .unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(
        proxy.requests.lock().unwrap()[1].2.as_ref().unwrap()["variables"]["after"],
        "next"
    );
    assert!(matches!(
        client.all::<Value>(LinearRead::Users, None).await,
        Err(TrackerError::Decode(_))
    ));
}

#[tokio::test(start_paused = true)]
async fn graphql_errors_never_return_partial_inventory() {
    let proxy = Arc::new(support::Proxy::new(vec![
        json!({"data":{"users":{"nodes":[]}},"errors":[{"message":"Access denied"}]}),
    ]));
    let user = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let connections = Connections::new(
        Arc::new(support::Store),
        Some(proxy),
        "linear",
        Duration::ZERO,
    );
    let client = Client::new(connections.open(&user).await.unwrap());
    assert!(matches!(
        client.all::<Value>(LinearRead::Users, None).await,
        Err(TrackerError::Upstream { status: 200, .. })
    ));
}

#[tokio::test(start_paused = true)]
async fn an_unreadable_node_is_reported_without_losing_its_neighbors() {
    let proxy = Arc::new(support::Proxy::new(vec![
        json!({"data":{"users":{"nodes":[{"id":"u1","name":"A","email":null},{"id":"bad/id","name":"Broken"},{"id":"u2","name":"B","email":null}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}),
    ]));
    let user = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let connections = Connections::new(
        Arc::new(support::Store),
        Some(proxy),
        "linear",
        Duration::ZERO,
    );
    let client = Client::new(connections.open(&user).await.unwrap());
    let users = client
        .all::<import_tracker::domain::model::User>(LinearRead::Users, None)
        .await
        .unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(client.warnings.lock().unwrap().len(), 1);
}
