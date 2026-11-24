use super::*;
use crate::domain::model::ForbiddenReason;
use connectors::fake::{FakeConnection, FakeConnectors};
use serde_json::json;
#[path = "../../../test_support.rs"]
mod support;

fn linear() -> &'static str {
    "linear"
}

#[tokio::test(start_paused = true)]
async fn rate_limit_holds_the_shared_account_and_retries() {
    let mut limited = support::answer(StatusCode::TOO_MANY_REQUESTS, json!({"limited":true}));
    limited
        .headers
        .insert(http::header::RETRY_AFTER, "10".parse().unwrap());
    let (_, service) = support::connected(
        "linear",
        vec![
            limited,
            support::ok(json!({"ok":true})),
            support::ok(json!({"ok":true})),
        ],
    );
    let connections = Connections::new(service, linear(), Duration::from_secs(1));
    let user = support::user();
    let a = connections.open(&user).await.unwrap();
    let b = connections.open(&user).await.unwrap();
    assert!(Arc::ptr_eq(&a.pacer, &b.pacer));
    let started = Instant::now();
    assert_eq!(
        a.read(Method::POST, "https://api.linear.app/graphql", None)
            .await
            .unwrap(),
        json!({"ok":true})
    );
    assert_eq!(Instant::now() - started, Duration::from_secs(10));
    b.read(Method::POST, "https://api.linear.app/graphql", None)
        .await
        .unwrap();
    assert_eq!(Instant::now() - started, Duration::from_secs(11));
}

#[tokio::test]
async fn reads_go_through_the_users_connection_to_the_fixed_url() {
    let (fake, service) = support::connected("linear", vec![support::ok(json!({"ok":true}))]);
    let connections = Connections::new(service, linear(), Duration::ZERO);
    let session = connections.open(&support::user()).await.unwrap();
    session
        .read(
            Method::POST,
            "https://api.linear.app/graphql",
            Some(&json!({"query":"query { viewer { id } }"})),
        )
        .await
        .unwrap();

    let calls = fake.api_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].method, Method::POST);
    assert_eq!(calls[0].url, "https://api.linear.app/graphql");
    assert_eq!(
        support::bodies(&fake),
        vec![Some(json!({"query":"query { viewer { id } }"}))]
    );
}

#[tokio::test]
async fn forbidden_answers_are_not_retried() {
    let (fake, service) = support::connected(
        "linear",
        vec![support::answer(StatusCode::FORBIDDEN, json!({}))],
    );
    let connections = Connections::new(service, linear(), Duration::ZERO);
    let session = connections.open(&support::user()).await.unwrap();
    assert!(matches!(
        session
            .read(Method::POST, "https://api.linear.app/graphql", None)
            .await,
        Err(TrackerError::Forbidden { status: 403, .. })
    ));
    assert_eq!(fake.api_calls().len(), 1);
}

async fn not_connected(fake: FakeConnectors) -> bool {
    let connections = Connections::new(Arc::new(fake.build()), linear(), Duration::ZERO);
    matches!(
        connections.open(&support::user()).await,
        Err(TrackerError::NotConnected)
    )
}

/// Opening reads only what the connectors services decide: anything but a
/// usable connection that provides the app's API is "not connected".
#[tokio::test]
async fn only_a_usable_connection_with_api_access_opens() {
    let user = support::user();

    assert!(not_connected(FakeConnectors::new().with_catalog_app("linear")).await);
    assert!(
        not_connected(
            FakeConnectors::new().with_connection(&user, FakeConnection::app("linear").disabled())
        )
        .await
    );
    assert!(
        not_connected(
            FakeConnectors::new()
                .with_connection(&user, FakeConnection::app("linear").needs_reauth())
        )
        .await
    );
    // A flagged user whose Connect app is tools-only has no API access.
    assert!(
        not_connected(
            FakeConnectors::new()
                .with_connect_app("linear", false)
                .with_macro_connect_enabled(&user)
                .with_connection(&user, FakeConnection::app("linear"))
        )
        .await
    );
    // An overlaid app's native server never gives API access.
    assert!(
        not_connected(
            FakeConnectors::new()
                .with_overlay("linear", "https://mcp.linear.app/mcp")
                .with_connection(&user, FakeConnection::app("linear"))
        )
        .await
    );

    // A flagged user's Connect app with API access opens.
    let connect = FakeConnectors::new()
        .with_connect_app("linear", true)
        .with_macro_connect_enabled(&user)
        .with_connection(&user, FakeConnection::app("linear"));
    let connections = Connections::new(Arc::new(connect.build()), linear(), Duration::ZERO);
    assert!(connections.open(&user).await.is_ok());
}

#[tokio::test]
async fn a_refusal_keeps_only_a_typed_reason_never_the_body() {
    let (_, service) = support::connected(
        "linear",
        vec![
            support::answer(
                StatusCode::FORBIDDEN,
                json!({"category": "MISSING_SCOPES", "message": "scope crm.objects.deals.read"}),
            ),
            support::answer(
                StatusCode::FORBIDDEN,
                json!({"message": "Ada Lovelace may not read this project"}),
            ),
        ],
    );
    let connections = Connections::new(service, linear(), Duration::ZERO);
    let session = connections.open(&support::user()).await.unwrap();
    let first = session
        .read(Method::POST, "https://api.linear.app/graphql", None)
        .await;
    assert!(
        matches!(
            first,
            Err(TrackerError::Forbidden {
                status: 403,
                reason: ForbiddenReason::MissingScopes
            })
        ),
        "{first:?}"
    );
    let second = session
        .read(Method::POST, "https://api.linear.app/graphql", None)
        .await;
    let error = second.unwrap_err();
    assert!(matches!(
        error,
        TrackerError::Forbidden {
            status: 403,
            reason: ForbiddenReason::Other
        }
    ));
    // Nothing the provider wrote about who may read what reaches a log.
    assert!(!format!("{error:?} {error}").contains("Ada"));
}
