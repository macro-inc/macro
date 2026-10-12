use super::*;
use crate::domain::models::PipedreamConnection;
use macro_user_id::cowlike::CowLike;
use std::sync::Mutex;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

struct OneConnection(Option<PipedreamConnection>);

impl ConnectionStore for OneConnection {
    type Err = anyhow::Error;

    async fn save(&self, _: &PipedreamConnection) -> Result<(), Self::Err> {
        unreachable!()
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        Ok(self
            .0
            .clone()
            .filter(|record| &record.user_id == user_id && record.app_slug == app_slug))
    }

    async fn delete(&self, _: &MacroUserIdStr<'static>, _: &str) -> Result<(), Self::Err> {
        unreachable!()
    }

    async fn list(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        unreachable!()
    }
}

#[derive(Default)]
struct RecordingTransport(Mutex<Vec<(String, ProxyRequest)>>);

impl ConnectProxyTransport for RecordingTransport {
    async fn send(
        &self,
        connection: &PipedreamConnection,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, ConnectProxyError> {
        self.0
            .lock()
            .unwrap()
            .push((connection.account_id.clone(), request));
        Ok(ProxyResponse {
            status: 200,
            retry_after: None,
            body: br#"{"ok":true}"#.to_vec(),
        })
    }
}

fn notion_connection() -> PipedreamConnection {
    PipedreamConnection {
        user_id: user("macro|user-1@example.com"),
        app_slug: "notion".into(),
        server_name: "Notion".into(),
        account_id: "apn_notion".into(),
        enabled: true,
    }
}

#[tokio::test]
async fn relays_through_the_users_account_for_the_app() {
    let transport = Arc::new(RecordingTransport::default());
    let proxy = PipedreamConnectProxy::new(
        Arc::new(OneConnection(Some(notion_connection()))),
        transport.clone(),
    );
    let request = ProxyRequest::get("https://api.notion.com/v1/users/me")
        .header("Notion-Version", "2025-09-03");

    let response = proxy
        .send(&user("macro|user-1@example.com"), "notion", request.clone())
        .await
        .unwrap();

    assert!(response.is_success());
    assert_eq!(
        response.json::<serde_json::Value>().unwrap(),
        serde_json::json!({"ok": true})
    );
    let sent = transport.0.lock().unwrap();
    assert_eq!(sent.as_slice(), &[("apn_notion".to_string(), request)]);
}

#[tokio::test]
async fn missing_connection_is_not_connected() {
    let transport = Arc::new(RecordingTransport::default());
    let proxy = PipedreamConnectProxy::new(
        Arc::new(OneConnection(Some(notion_connection()))),
        transport.clone(),
    );

    let error = proxy
        .send(
            &user("macro|user-1@example.com"),
            "linear",
            ProxyRequest::get("https://api.linear.app/graphql"),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ConnectProxyError::NotConnected { app_slug } if app_slug == "linear"));
    assert!(transport.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unconfigured_transport_refuses() {
    let proxy = PipedreamConnectProxy::new(
        Arc::new(OneConnection(Some(notion_connection()))),
        Arc::new(None::<Arc<RecordingTransport>>),
    );

    let error = proxy
        .send(
            &user("macro|user-1@example.com"),
            "notion",
            ProxyRequest::get("https://api.notion.com/v1/users/me"),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ConnectProxyError::NotConfigured));
}
