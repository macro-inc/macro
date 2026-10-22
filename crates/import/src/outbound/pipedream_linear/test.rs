use std::sync::{Arc, Mutex};

use http::{HeaderMap, Method, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::PipedreamConnection;
use pipedream_mcp::domain::ports::{ConnectedAppProxy, ConnectionStore, ProxyResponse};
use serde_json::{Value, json};

use super::PipedreamLinearIssues;
use crate::domain::ports::{LinearIssueSource, LinearSourceError};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("ada@acme.example").expect("valid user")
}

fn connection(enabled: bool) -> PipedreamConnection {
    PipedreamConnection {
        user_id: user(),
        app_slug: "linear".to_owned(),
        server_name: "Linear".to_owned(),
        account_id: "apn_linear".to_owned(),
        enabled,
    }
}

struct OneConnection(Option<PipedreamConnection>);

impl ConnectionStore for OneConnection {
    type Err = String;

    async fn save(&self, _record: &PipedreamConnection) -> Result<(), String> {
        unreachable!("connections are never saved by the importer")
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, String> {
        Ok(self
            .0
            .clone()
            .filter(|connection| &connection.user_id == user_id && connection.app_slug == app_slug))
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<(), String> {
        unreachable!("connections are never deleted by the importer")
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, String> {
        unreachable!("connections are loaded by app")
    }
}

/// Answers each request with the next canned body, recording what was sent.
struct CannedProxy {
    answers: Mutex<Vec<(StatusCode, Value)>>,
    sent: Mutex<Vec<(Method, String, Value)>>,
}

impl CannedProxy {
    fn new(answers: Vec<(StatusCode, Value)>) -> Self {
        Self {
            answers: Mutex::new(answers.into_iter().rev().collect()),
            sent: Mutex::new(Vec::new()),
        }
    }
}

impl ConnectedAppProxy for CannedProxy {
    async fn proxy(
        &self,
        _connection: &PipedreamConnection,
        method: Method,
        url: &str,
        _headers: &HeaderMap,
        body: Option<&Value>,
    ) -> anyhow::Result<ProxyResponse> {
        self.sent.lock().unwrap().push((
            method,
            url.to_owned(),
            body.cloned().unwrap_or(Value::Null),
        ));
        let (status, body) = self.answers.lock().unwrap().pop().expect("an answer");
        Ok(ProxyResponse {
            status,
            headers: HeaderMap::new(),
            body: body.to_string(),
        })
    }
}

fn page(issues: Value, next: Option<&str>) -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({
            "data": {
                "issues": {
                    "nodes": issues,
                    "pageInfo": { "hasNextPage": next.is_some(), "endCursor": next },
                }
            }
        }),
    )
}

/// The answer to the "who am I" query.
fn viewer(admin: bool) -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({ "data": { "viewer": { "admin": admin } } }),
    )
}

fn source(
    connection: Option<PipedreamConnection>,
    proxy: CannedProxy,
) -> (
    PipedreamLinearIssues<OneConnection, CannedProxy>,
    Arc<CannedProxy>,
) {
    let proxy = Arc::new(proxy);
    (
        PipedreamLinearIssues::new(Arc::new(OneConnection(connection)), Some(proxy.clone())),
        proxy,
    )
}

#[tokio::test]
async fn open_issues_come_back_as_task_metadata_across_pages() {
    let (linear, proxy) = source(
        Some(connection(true)),
        CannedProxy::new(vec![
            viewer(true),
            page(
                json!([{
                    "identifier": "ENG-12",
                    "title": "Fix login",
                    "description": "Users get logged out.",
                    "url": "https://linear.app/acme/issue/ENG-12",
                    "priorityLabel": "High",
                    "dueDate": "2026-11-01",
                    "state": { "name": "In Progress", "type": "started" },
                    "assignee": { "name": "Ada", "email": "ada@acme.example" },
                }]),
                Some("cursor-1"),
            ),
            page(
                json!([{
                    "identifier": "ENG-13",
                    "title": "Ship search",
                    "description": null,
                    "url": null,
                    "priorityLabel": "No priority",
                    "dueDate": null,
                    "state": { "name": "In QA", "type": "started" },
                    "assignee": null,
                }]),
                None,
            ),
        ]),
    );

    let issues = linear
        .open_issues(&user(), 50)
        .await
        .expect("read")
        .expect("connected");

    assert_eq!(issues.len(), 2);
    assert_eq!(issues[0].identifier.as_deref(), Some("ENG-12"));
    assert_eq!(issues[0].status.as_deref(), Some("In Progress"));
    assert_eq!(issues[0].priority.as_deref(), Some("High"));
    assert_eq!(
        issues[0].assignee_email.as_deref(),
        Some("ada@acme.example")
    );
    // A custom state falls back to its type, and "No priority" is no priority.
    assert_eq!(issues[1].status.as_deref(), Some("started"));
    assert_eq!(issues[1].priority, None);

    let sent = proxy.sent.lock().unwrap();
    assert_eq!(sent.len(), 3);
    assert_eq!(sent[1].0, Method::POST);
    assert_eq!(sent[1].1, "https://api.linear.app/graphql");
    assert_eq!(sent[1].2["variables"]["after"], Value::Null);
    assert_eq!(sent[2].2["variables"]["after"], "cursor-1");
    // An admin gets the whole workspace's open issues.
    assert!(sent[1].2["variables"]["filter"].get("or").is_none());
}

#[tokio::test]
async fn reading_stops_at_the_limit() {
    let issue = json!({
        "identifier": "ENG-1", "title": "One", "description": null, "url": null,
        "priorityLabel": null, "dueDate": null, "state": null, "assignee": null,
    });
    let (linear, proxy) = source(
        Some(connection(true)),
        CannedProxy::new(vec![
            viewer(true),
            page(json!([issue.clone(), issue]), Some("more")),
        ]),
    );

    let issues = linear
        .open_issues(&user(), 2)
        .await
        .expect("read")
        .expect("connected");

    assert_eq!(issues.len(), 2);
    assert_eq!(proxy.sent.lock().unwrap()[1].2["variables"]["first"], 2);
}

#[tokio::test]
async fn without_an_enabled_connection_linear_is_not_connected() {
    let (linear, proxy) = source(Some(connection(false)), CannedProxy::new(Vec::new()));

    assert!(
        linear
            .open_issues(&user(), 50)
            .await
            .expect("read")
            .is_none()
    );
    assert!(proxy.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn graphql_errors_and_rate_limits_are_reported() {
    let (linear, _) = source(
        Some(connection(true)),
        CannedProxy::new(vec![
            viewer(true),
            (
                StatusCode::OK,
                json!({ "data": null, "errors": [{ "message": "Authentication required" }] }),
            ),
        ]),
    );
    assert!(matches!(
        linear.open_issues(&user(), 50).await,
        Err(LinearSourceError::Api(message)) if message == "Authentication required"
    ));

    let (linear, _) = source(
        Some(connection(true)),
        CannedProxy::new(vec![(StatusCode::TOO_MANY_REQUESTS, json!({}))]),
    );
    assert!(matches!(
        linear.open_issues(&user(), 50).await,
        Err(LinearSourceError::RateLimited)
    ));
}

#[tokio::test]
async fn someone_who_isnt_an_admin_gets_only_their_own_issues() {
    let (linear, proxy) = source(
        Some(connection(true)),
        CannedProxy::new(vec![viewer(false), page(json!([]), None)]),
    );

    linear.open_issues(&user(), 50).await.expect("read");

    let sent = proxy.sent.lock().unwrap();
    let filter = &sent[1].2["variables"]["filter"];
    assert_eq!(filter["or"][0]["assignee"]["isMe"]["eq"], true);
    assert_eq!(filter["or"][1]["creator"]["isMe"]["eq"], true);
    assert_eq!(filter["updatedAt"]["gt"], "-P90D");
}
