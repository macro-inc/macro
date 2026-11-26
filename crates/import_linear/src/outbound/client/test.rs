use super::*;
use connectors::Connectors;
use connectors::fake::{FakeConnection, FakeConnectors};
use strum::IntoEnumIterator;
#[path = "../../../../import_tracker/test_support.rs"]
mod support;

async fn client(service: Arc<Connectors>) -> Client<Connectors> {
    let connections = Connections::new(service, LINEAR_APP, Duration::ZERO);
    Client::new(connections.open(&support::user()).await.unwrap())
}

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
    let (fake, service) = support::connected(
        "linear",
        vec![
            support::ok(
                json!({"data":{"users":{"nodes":[{"id":"u1","name":"A","email":null}],"pageInfo":{"hasNextPage":true,"endCursor":"next"}}}}),
            ),
            support::ok(
                json!({"data":{"users":{"nodes":[{"id":"u2","name":"B","email":"b@example.com"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}),
            ),
            support::ok(
                json!({"data":{"users":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}}),
            ),
            support::ok(
                json!({"data":{"users":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}}),
            ),
        ],
    );
    let client = client(service).await;
    let users = client
        .all::<import_tracker::domain::model::User>(LinearRead::Users, None)
        .await
        .unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(
        support::bodies(&fake)[1].as_ref().unwrap()["variables"]["after"],
        "next"
    );
    assert!(matches!(
        client.all::<Value>(LinearRead::Users, None).await,
        Err(TrackerError::Decode(_))
    ));
}

#[tokio::test(start_paused = true)]
async fn graphql_errors_never_return_partial_inventory() {
    let (_, service) = support::connected(
        "linear",
        vec![support::ok(
            json!({"data":{"users":{"nodes":[]}},"errors":[{"message":"Access denied"}]}),
        )],
    );
    let client = client(service).await;
    assert!(matches!(
        client.all::<Value>(LinearRead::Users, None).await,
        Err(TrackerError::Upstream { status: 200, .. })
    ));
}

#[tokio::test(start_paused = true)]
async fn an_unreadable_node_is_reported_without_losing_its_neighbors() {
    let (_, service) = support::connected(
        "linear",
        vec![support::ok(
            json!({"data":{"users":{"nodes":[{"id":"u1","name":"A","email":null},{"id":"bad/id","name":"Broken"},{"id":"u2","name":"B","email":null}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}),
        )],
    );
    let client = client(service).await;
    let users = client
        .all::<import_tracker::domain::model::User>(LinearRead::Users, None)
        .await
        .unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(client.warnings.lock().unwrap().len(), 1);
}

/// The importer reads Linear only through a connection the connectors
/// services count and that provides Linear's API.
#[tokio::test(start_paused = true)]
async fn an_inventory_needs_a_connection_with_api_access() {
    let user = support::user();
    let tools_only = FakeConnectors::new()
        .with_connect_app("linear", false)
        .with_macro_connect_enabled(&user)
        .with_connection(&user, FakeConnection::app("linear"));
    let connections = LinearConnections::new(Arc::new(tools_only.build()));
    assert!(matches!(
        connections.inventory(&user, &|_, _| {}).await,
        Err(TrackerError::NotConnected)
    ));

    let empty = support::ok(
        json!({"data":{"teams":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}),
    );
    let (fake, service) = support::connected("linear", vec![empty]);
    let connections = LinearConnections::new(service);
    // The fake answers `{}` after the first read, which is not a page.
    assert!(matches!(
        connections.inventory(&user, &|_, _| {}).await,
        Err(TrackerError::Decode(_))
    ));
    let calls = fake.api_calls();
    assert_eq!(calls.len(), 2);
    assert!(
        calls
            .iter()
            .all(|call| call.url == "https://api.linear.app/graphql")
    );
}
