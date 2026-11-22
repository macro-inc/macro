use super::*;
use crate::domain::models::{ConnectorId, ServerUrl};
use crate::fake::{FakeConnection, FakeConnectors};
use crate::inbound::ConnectorChange;
use crate::inbound::dto::{ImportSurface, key_string};
use crate::inbound::test_support::{NameIsToken, authorization, services, user};
use axum::body::{Body, to_bytes};
use axum::http::Request;
use serde_json::{Value, json};
use std::sync::Mutex;
use tower::ServiceExt as _;

/// The routes over `fake`, recording every hook call.
struct Harness {
    router: Router,
    connected: Arc<Mutex<Vec<ConnectorChange>>>,
    removed: Arc<Mutex<Vec<ConnectorChange>>>,
}

fn recorder(log: &Arc<Mutex<Vec<ConnectorChange>>>) -> ConnectorHook {
    let log = log.clone();
    Arc::new(move |change| {
        log.lock().unwrap().push(change);
        Box::pin(async {})
    })
}

fn harness(fake: &FakeConnectors) -> Harness {
    let (connectors, catalog) = services(fake);
    let connected = Arc::new(Mutex::new(Vec::new()));
    let removed = Arc::new(Mutex::new(Vec::new()));
    let state: ConnectorsRouterState<_, _, NameIsToken> =
        ConnectorsRouterState::new(connectors, catalog, authorization())
            .with_importable(
                Importable::new().with(ConnectorId::parse("linear").unwrap(), ImportSurface::Api),
            )
            .with_connected_hook(recorder(&connected))
            .with_removed_hook(recorder(&removed));

    Harness {
        router: connectors_router(state),
        connected,
        removed,
    }
}

impl Harness {
    async fn send(
        &self,
        method: &str,
        uri: &str,
        token: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", format!("Bearer {token}"));
        let body = match body {
            Some(body) => {
                request = request.header("content-type", "application/json");
                Body::from(body.to_string())
            }
            None => Body::empty(),
        };
        let response = self
            .router
            .clone()
            .oneshot(request.body(body).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, body)
    }

    async fn list(&self, token: &str) -> Vec<Value> {
        let (status, body) = self.send("GET", "/connectors", token, None).await;
        assert_eq!(status, StatusCode::OK);
        body.as_array().unwrap().clone()
    }

    async fn find(&self, token: &str, key: &str) -> Option<Value> {
        self.list(token)
            .await
            .into_iter()
            .find(|connector| connector["key"] == key)
    }
}

fn server_key(url: &str) -> String {
    key_string(&ConnectorKey::Server(ServerUrl::parse(url).unwrap()))
}

/// Every field of a listed connector: no source, no provider.
const CONNECTOR_FIELDS: [&str; 8] = [
    "api",
    "connectable",
    "importAvailable",
    "key",
    "mcp",
    "name",
    "status",
    "target",
];

#[tokio::test]
async fn requests_without_a_valid_user_are_refused() {
    let harness = harness(&FakeConnectors::new());

    let (status, _) = harness.send("GET", "/connectors", "invalid", None).await;
    let unauthenticated = harness
        .router
        .clone()
        .oneshot(Request::get("/connectors").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_list_shows_what_the_user_holds_and_never_a_source() {
    let owner = user("owner");
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_overlay("figma", "https://mcp.figma.com/mcp")
        .with_connection(&owner, FakeConnection::app("linear").named("Linear"))
        .with_connection(&owner, FakeConnection::app("figma").named("Figma"))
        .with_connection(&owner, FakeConnection::app("github").needs_reauth())
        .with_connection(
            &owner,
            FakeConnection::server("https://mcp.example.com/mcp").named("Example"),
        )
        .with_connection(&user("stranger"), FakeConnection::app("notion"));
    let harness = harness(&fake);

    let listed = harness.list("owner").await;

    let mut keys: Vec<&str> = listed
        .iter()
        .map(|connector| connector["key"].as_str().unwrap())
        .collect();
    keys.sort_unstable();
    let example = server_key("https://mcp.example.com/mcp");
    let mut expected = vec!["app/figma", "app/github", "app/linear", example.as_str()];
    expected.sort_unstable();
    assert_eq!(keys, expected);

    for connector in &listed {
        let mut fields: Vec<&str> = connector
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        fields.sort_unstable();
        assert_eq!(fields, CONNECTOR_FIELDS, "{connector}");
    }

    let linear = harness.find("owner", "app/linear").await.unwrap();
    assert_eq!(linear["status"], "connected");
    assert_eq!(linear["api"], true);
    assert_eq!(linear["importAvailable"], true);
    assert_eq!(linear["target"], json!({"type": "app", "slug": "linear"}));

    // An overlaid app reads as the app, not as the server behind it.
    let figma = harness.find("owner", "app/figma").await.unwrap();
    assert_eq!(figma["status"], "connected");
    assert_eq!(figma["api"], false);

    let github = harness.find("owner", "app/github").await.unwrap();
    assert_eq!(github["status"], "needsReauth");
}

#[tokio::test]
async fn another_users_connections_are_not_listed() {
    let fake = FakeConnectors::new()
        .with_catalog_app("notion")
        .with_connection(&user("stranger"), FakeConnection::app("notion"));
    let harness = harness(&fake);

    assert!(harness.list("owner").await.is_empty());
    assert_eq!(harness.list("stranger").await.len(), 1);
}

#[tokio::test]
async fn connecting_answers_the_step_to_take() {
    let fake = FakeConnectors::new().with_catalog_app("linear");
    let harness = harness(&fake);

    let (status, body) = harness
        .send("POST", "/connectors/app/linear/connect", "owner", None)
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["type"], "openUrl");
    assert!(body["url"].as_str().unwrap().starts_with("https://"));
}

/// GitHub is no special case: the answer is a page to open, the app's own
/// link page for a user the account link counts for, and Connect's consent
/// for a user on Connect.
#[tokio::test]
async fn connecting_github_answers_the_page_of_the_source_that_counts() {
    let flagged = user("flagged");
    let fake = FakeConnectors::new()
        .with_connect_app("github", false)
        .with_flag_on(&flagged);
    let harness = harness(&fake);

    let (status, linked) = harness
        .send("POST", "/connectors/app/github/connect", "owner", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        linked,
        json!({"type": "openUrl", "url": crate::fake::source::FAKE_GITHUB_LINK_PAGE})
    );

    let (status, on_connect) = harness
        .send("POST", "/connectors/app/github/connect", "flagged", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(on_connect["type"], "openUrl");
    assert!(
        on_connect["url"]
            .as_str()
            .unwrap()
            .starts_with("https://connect.fake.test/")
    );
}

#[tokio::test]
async fn connecting_an_app_nobody_serves_is_not_found() {
    let harness = harness(&FakeConnectors::new());

    let (status, _) = harness
        .send("POST", "/connectors/app/nowhere/connect", "owner", None)
        .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn completing_records_the_connection_and_tells_the_hook() {
    let fake = FakeConnectors::new().with_catalog_app("linear");
    let harness = harness(&fake);

    let (status, body) = harness
        .send("POST", "/connectors/app/linear/complete", "owner", None)
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["key"], "app/linear");
    assert_eq!(body["status"], "connected");
    assert_eq!(
        *harness.connected.lock().unwrap(),
        [ConnectorChange {
            user: user("owner"),
            key: ConnectorKey::App(ConnectorId::parse("linear").unwrap()),
        }]
    );
    assert!(harness.find("owner", "app/linear").await.is_some());
}

#[tokio::test]
async fn completing_an_app_nobody_serves_is_not_found_and_tells_no_hook() {
    let harness = harness(&FakeConnectors::new());

    let (status, _) = harness
        .send("POST", "/connectors/app/nowhere/complete", "owner", None)
        .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(harness.connected.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disable_rename_and_remove_round_trip() {
    let owner = user("owner");
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_connection(&owner, FakeConnection::app("linear"));
    let harness = harness(&fake);

    let (status, _) = harness
        .send(
            "PATCH",
            "/connectors/app/linear",
            "owner",
            Some(json!({"enabled": false})),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let linear = harness.find("owner", "app/linear").await.unwrap();
    assert_eq!(linear["status"], "disabled");

    let (status, _) = harness
        .send(
            "PATCH",
            "/connectors/app/linear",
            "owner",
            Some(json!({"enabled": true, "name": "Work Linear"})),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let linear = harness.find("owner", "app/linear").await.unwrap();
    assert_eq!(linear["status"], "connected");
    assert_eq!(linear["name"], "Work Linear");

    let (status, _) = harness
        .send("DELETE", "/connectors/app/linear", "owner", None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(harness.find("owner", "app/linear").await.is_none());
    assert_eq!(harness.removed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_server_round_trips_by_its_key() {
    let harness = harness(&FakeConnectors::new());

    let (status, added) = harness
        .send(
            "POST",
            "/connectors",
            "owner",
            Some(json!({"url": "https://mcp.example.com/mcp/", "name": "Example"})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let key = server_key("https://mcp.example.com/mcp");
    assert_eq!(added["key"], key.as_str());
    assert_eq!(
        added["target"],
        json!({"type": "server", "url": "https://mcp.example.com/mcp"})
    );

    let (status, step) = harness
        .send("POST", &format!("/connectors/{key}/connect"), "owner", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(step["type"], "openUrl");

    let (status, completed) = harness
        .send(
            "POST",
            &format!("/connectors/{key}/complete"),
            "owner",
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(completed["key"], key.as_str());

    let (status, _) = harness
        .send(
            "PATCH",
            &format!("/connectors/{key}"),
            "owner",
            Some(json!({"name": "Renamed"})),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        harness.find("owner", &key).await.unwrap()["name"],
        "Renamed"
    );

    let (status, _) = harness
        .send("DELETE", &format!("/connectors/{key}"), "owner", None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(harness.list("owner").await.is_empty());
}

#[tokio::test]
async fn adding_a_server_that_is_not_a_url_is_refused() {
    let harness = harness(&FakeConnectors::new());

    for body in [
        json!({"url": "not a url", "name": "Broken"}),
        json!({"url": "ftp://example.com", "name": "Broken"}),
        json!({"url": "https://mcp.example.com/mcp", "name": "  "}),
    ] {
        let (status, _) = harness
            .send("POST", "/connectors", "owner", Some(body.clone()))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert!(harness.list("owner").await.is_empty());
}

#[tokio::test]
async fn a_key_the_user_does_not_hold_is_not_found() {
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_connection(&user("stranger"), FakeConnection::app("linear"));
    let harness = harness(&fake);
    let unknown_server = server_key("https://mcp.unknown.com/mcp");

    for (method, uri, body) in [
        (
            "PATCH",
            "/connectors/app/linear".to_owned(),
            Some(json!({"enabled": false})),
        ),
        ("DELETE", "/connectors/app/linear".to_owned(), None),
        ("DELETE", format!("/connectors/{unknown_server}"), None),
        (
            "POST",
            format!("/connectors/{unknown_server}/complete"),
            None,
        ),
    ] {
        let (status, _) = harness.send(method, &uri, "owner", body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {uri}");
    }

    // The other user's connection is untouched.
    let stranger = harness.find("stranger", "app/linear").await.unwrap();
    assert_eq!(stranger["status"], "connected");
    assert!(harness.removed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn malformed_keys_are_bad_requests() {
    let harness = harness(&FakeConnectors::new());

    for uri in [
        "/connectors/app/Not%20A%20Slug",
        "/connectors/server/not-a-url",
        "/connectors/source/linear",
    ] {
        let (status, _) = harness.send("DELETE", uri, "owner", None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
    }
}

#[tokio::test]
async fn an_update_must_change_something() {
    let owner = user("owner");
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_connection(&owner, FakeConnection::app("linear"));
    let harness = harness(&fake);

    let (status, _) = harness
        .send("PATCH", "/connectors/app/linear", "owner", Some(json!({})))
        .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn removing_github_unlinks_the_account() {
    let owner = user("owner");
    let fake = FakeConnectors::new().with_connection(&owner, FakeConnection::app("github"));
    let harness = harness(&fake);

    let (status, _) = harness
        .send("DELETE", "/connectors/app/github", "owner", None)
        .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(harness.find("owner", "app/github").await.is_none());
    assert_eq!(
        *harness.removed.lock().unwrap(),
        [ConnectorChange {
            user: owner,
            key: ConnectorKey::App(ConnectorId::parse("github").unwrap()),
        }]
    );
}

#[tokio::test]
async fn the_catalog_lists_apps_by_key() {
    let harness = harness(&FakeConnectors::new());

    let (status, page) = harness
        .send(
            "GET",
            "/connectors/catalog?search=lin&limit=5",
            "owner",
            None,
        )
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["nextCursor"], "page-2");
    assert_eq!(
        page["apps"][0],
        json!({
            "key": "app/linear",
            "slug": "linear",
            "name": "Linear",
            "description": "Linear from the directory",
            "iconUrl": null,
            "categories": ["Productivity"],
        })
    );
}
