use std::sync::{Arc, Mutex};
use std::time::Duration;

use http::{HeaderMap, Method, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::PipedreamConnection;
use pipedream_mcp::domain::ports::{ConnectedAppProxy, ConnectionStore, ProxyResponse};
use tokio::time::Instant;

use super::PipedreamNotionConnections;
use crate::domain::model::NotionId;
use crate::domain::ports::{NotionApi, NotionConnections};

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
        assert_eq!(app_slug, "notion");
        Ok(self
            .0
            .clone()
            .filter(|connection| &connection.user_id == user_id))
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

#[derive(Debug, Clone, PartialEq)]
struct ProxiedRequest {
    account_id: String,
    method: Method,
    url: String,
    headers: HeaderMap,
    at: Instant,
}

#[derive(Default)]
struct RecordingProxy {
    requests: Mutex<Vec<ProxiedRequest>>,
}

impl ConnectedAppProxy for RecordingProxy {
    async fn proxy(
        &self,
        connection: &PipedreamConnection,
        method: Method,
        url: &str,
        headers: &HeaderMap,
        _body: Option<&serde_json::Value>,
    ) -> anyhow::Result<ProxyResponse> {
        self.requests.lock().unwrap().push(ProxiedRequest {
            account_id: connection.account_id.clone(),
            method,
            url: url.to_owned(),
            headers: headers.clone(),
            at: Instant::now(),
        });
        Ok(ProxyResponse {
            status: StatusCode::OK,
            headers: HeaderMap::new(),
            body: r#"{"object":"database","data_sources":[]}"#.into(),
        })
    }
}

#[tokio::test(start_paused = true)]
async fn a_connected_user_reaches_notion_through_the_proxy_with_one_pacer_per_account() {
    let user = MacroUserIdStr::try_from_email("caller@example.com").unwrap();
    let store = Arc::new(OneConnection(Some(PipedreamConnection {
        user_id: user.clone(),
        app_slug: "notion".into(),
        server_name: "Notion".into(),
        account_id: "apn_notion".into(),
        enabled: true,
    })));
    let proxy = Arc::new(RecordingProxy::default());
    let connections = PipedreamNotionConnections::new(store, Some(proxy.clone()));
    let started = Instant::now();

    let first = connections.for_user(&user).await.unwrap().unwrap();
    let second = connections.for_user(&user).await.unwrap().unwrap();
    let database = NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap();
    let (a, b) = tokio::join!(
        first.database_sources(&database),
        second.database_sources(&database)
    );

    assert_eq!(a.unwrap(), vec![]);
    assert_eq!(b.unwrap(), vec![]);
    let requests = proxy.requests.lock().unwrap().clone();
    assert_eq!(
        requests[0],
        ProxiedRequest {
            account_id: "apn_notion".into(),
            method: Method::GET,
            url: "https://api.notion.com/v1/databases/d9824bdc84454327be8b5b47500af6ce".into(),
            headers: HeaderMap::from_iter([
                (
                    http::HeaderName::from_static("notion-version"),
                    http::HeaderValue::from_static("2026-03-11"),
                ),
                (
                    http::header::CONTENT_TYPE,
                    http::HeaderValue::from_static("application/json"),
                ),
            ]),
            at: started,
        }
    );
    // Two clients of the same account share its pacer.
    assert_eq!(requests[1].at - started, Duration::from_millis(340));
}

#[tokio::test]
async fn no_connection_a_disabled_one_or_no_proxy_means_no_notion() {
    let user = MacroUserIdStr::try_from_email("caller@example.com").unwrap();
    let disabled = PipedreamConnection {
        user_id: user.clone(),
        app_slug: "notion".into(),
        server_name: "Notion".into(),
        account_id: "apn_notion".into(),
        enabled: false,
    };
    let enabled = PipedreamConnection {
        enabled: true,
        ..disabled.clone()
    };

    let missing = PipedreamNotionConnections::new(
        Arc::new(OneConnection(None)),
        Some(Arc::new(RecordingProxy::default())),
    );
    let turned_off = PipedreamNotionConnections::new(
        Arc::new(OneConnection(Some(disabled))),
        Some(Arc::new(RecordingProxy::default())),
    );
    let unconfigured = PipedreamNotionConnections::<_, RecordingProxy>::new(
        Arc::new(OneConnection(Some(enabled))),
        None,
    );

    assert!(missing.for_user(&user).await.unwrap().is_none());
    assert!(turned_off.for_user(&user).await.unwrap().is_none());
    assert!(unconfigured.for_user(&user).await.unwrap().is_none());
}
