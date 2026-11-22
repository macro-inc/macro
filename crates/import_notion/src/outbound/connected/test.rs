use std::sync::Arc;
use std::time::Duration;

use connectors::domain::models::ApiResponse;
use connectors::fake::{FakeConnection, FakeConnectors};
use http::{HeaderMap, Method, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::time::Instant;

use super::ConnectedNotion;
use crate::domain::model::NotionId;
use crate::domain::ports::{NotionApi, NotionConnections};

const EMPTY_DATABASE: &str = r#"{"object":"database","data_sources":[]}"#;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("caller@example.com").unwrap()
}

fn connections(fake: &FakeConnectors) -> ConnectedNotion<connectors::domain::service::Connectors> {
    ConnectedNotion::new(Arc::new(fake.build()))
}

#[tokio::test(start_paused = true)]
async fn a_connected_user_reaches_notion_through_their_connection_with_one_pacer() {
    let fake = FakeConnectors::new().with_connection(
        &user(),
        FakeConnection::app("notion").answering(StatusCode::OK, EMPTY_DATABASE),
    );
    let connections = connections(&fake);
    let started = Instant::now();

    let first = connections.for_user(&user()).await.unwrap().unwrap();
    let second = connections.for_user(&user()).await.unwrap().unwrap();
    let database = NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap();
    let (a, b) = tokio::join!(
        first.database_sources(&database),
        second.database_sources(&database)
    );

    assert_eq!(a.unwrap(), vec![]);
    assert_eq!(b.unwrap(), vec![]);
    let calls = fake.api_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].method, Method::GET);
    assert_eq!(
        calls[0].url,
        "https://api.notion.com/v1/databases/d9824bdc84454327be8b5b47500af6ce"
    );
    assert_eq!(
        calls[0].headers,
        HeaderMap::from_iter([
            (
                http::HeaderName::from_static("notion-version"),
                http::HeaderValue::from_static("2026-03-11"),
            ),
            (
                http::header::CONTENT_TYPE,
                http::HeaderValue::from_static("application/json"),
            ),
        ])
    );
    // Two clients of the same user's connection share its pacer.
    assert_eq!(Instant::now() - started, Duration::from_millis(340));
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_is_retried_after_notion_says() {
    let mut limited = ApiResponse {
        status: StatusCode::TOO_MANY_REQUESTS,
        headers: HeaderMap::new(),
        body: "{}".into(),
    };
    limited
        .headers
        .insert(http::header::RETRY_AFTER, "5".parse().unwrap());
    let fake = FakeConnectors::new().with_connection(
        &user(),
        FakeConnection::app("notion")
            .answering(StatusCode::OK, EMPTY_DATABASE)
            .answering_in_turn([limited]),
    );
    let api = connections(&fake).for_user(&user()).await.unwrap().unwrap();
    let started = Instant::now();

    let database = NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap();
    assert_eq!(api.database_sources(&database).await.unwrap(), vec![]);
    assert_eq!(fake.api_calls().len(), 2);
    assert!(Instant::now() - started >= Duration::from_secs(5));
}

/// Notion is reached only through a connection the connectors services
/// count and that provides Notion's API; anything else is "no Notion".
#[tokio::test]
async fn without_a_usable_connection_with_api_access_there_is_no_notion() {
    let user = user();
    let unconnected = FakeConnectors::new().with_catalog_app("notion");
    let disabled =
        FakeConnectors::new().with_connection(&user, FakeConnection::app("notion").disabled());
    let needs_reauth =
        FakeConnectors::new().with_connection(&user, FakeConnection::app("notion").needs_reauth());
    // An old native Notion server is a server added by URL now: no API.
    let native_server = FakeConnectors::new()
        .with_catalog_app("notion")
        .with_connection(&user, FakeConnection::server("https://mcp.notion.com/mcp"));
    // A flagged user's tools-only Connect app has no API.
    let tools_only = FakeConnectors::new()
        .with_connect_app("notion", false)
        .with_flag_on(&user)
        .with_connection(&user, FakeConnection::app("notion"));

    for fake in [
        unconnected,
        disabled,
        needs_reauth,
        native_server,
        tools_only,
    ] {
        assert!(connections(&fake).for_user(&user).await.unwrap().is_none());
    }

    // A flagged user's Connect app with API access reaches Notion.
    let connect = FakeConnectors::new()
        .with_connect_app("notion", true)
        .with_flag_on(&user)
        .with_connection(&user, FakeConnection::app("notion"));
    assert!(
        connections(&connect)
            .for_user(&user)
            .await
            .unwrap()
            .is_some()
    );
}
