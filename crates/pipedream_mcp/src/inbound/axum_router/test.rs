use super::pipedream_webhook_router;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

const SECRET: &str = "s3cret";
const SUCCESS_BODY: &str = r#"{"event":"CONNECTION_SUCCESS"}"#;

fn router() -> axum::Router {
    pipedream_webhook_router(SECRET.to_owned())
}

async fn post_webhook(uri: &str, body: &'static str) -> StatusCode {
    router()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn webhook_rejects_missing_secret() {
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook", SUCCESS_BODY).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn webhook_rejects_wrong_secret() {
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook?secret=wrong", SUCCESS_BODY).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn webhook_accepts_matching_secret() {
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook?secret=s3cret", SUCCESS_BODY).await,
        StatusCode::NO_CONTENT
    );
}

/// The `macro-connect` flag off: what every user off the rollout gets. Each
/// fixture holds enabled Pipedream rows for an app Connect serves, so the
/// control tests with the flag on show the same fixture prompts.
mod flag_off {
    use super::*;
    use crate::domain::models::{
        CatalogEntry, CatalogPage, ConnectApp, ConnectToken, ConnectionProvider, ConnectorOverlay,
        MacroUserIdStr, PipedreamAccount, PipedreamConnection,
    };
    use crate::domain::ports::{
        ConnectRollout, ConnectionStore, ConnectorDirectory, ConnectorOverlays, MacroConnect,
        PipedreamConnect,
    };
    use crate::inbound::axum_router::{PipedreamRouterState, pipedream_mcp_router};
    use crate::outbound::api::{McpUpstream, McpUpstreamCall};
    use crate::outbound::dispatch::ConnectorBackends;
    use axum::http::header;
    use macro_authorization::{
        InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
        MacroAuthorizationState, ValidatedCredential,
    };
    use model_user::UserContext;
    use rootcause::Report;
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};
    use url::Url;

    const USER_ID: &str = "macro|ada@example.com";

    fn user_id() -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from_email("ada@example.com").unwrap()
    }

    #[derive(Clone)]
    struct FakeAuthorization;

    impl MacroAuthorizationService for FakeAuthorization {
        async fn authorize(
            &self,
            _jwt: &str,
        ) -> Result<UserContext, Report<MacroAuthorizationError>> {
            Ok(UserContext {
                user_id: USER_ID.to_owned(),
                fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_owned(),
                permissions: None,
                organization_id: None,
            })
        }

        async fn authorize_identity(
            &self,
            jwt: &str,
        ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
            self.authorize(jwt).await.map(ValidatedCredential::session)
        }

        async fn authorize_internal(
            &self,
            _provided_key: &str,
            _claims: InternalIdentityClaims,
        ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
            Err(Report::new(MacroAuthorizationError::InvalidCredentials))
        }
    }

    /// One backend. Records every call, so a test can prove Connect was never
    /// asked.
    #[derive(Clone)]
    struct Fake {
        name: &'static str,
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl Fake {
        fn new(name: &'static str) -> Self {
            Self {
                name,
                calls: Arc::default(),
            }
        }

        fn called(&self, call: impl Into<String>) {
            self.calls.lock().unwrap().push(call.into());
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl PipedreamConnect for Fake {
        async fn create_connect_token(
            &self,
            _external_user_id: &str,
        ) -> anyhow::Result<ConnectToken> {
            self.called("create_connect_token");
            Ok(ConnectToken {
                token: "ctok_test".into(),
                expires_at: "2099-01-01T00:00:00Z".into(),
                connect_link_url: "https://pipedream.test/connect".into(),
            })
        }

        async fn get_account(&self, account_id: &str) -> anyhow::Result<Option<PipedreamAccount>> {
            self.called(format!("get_account {account_id}"));
            Ok(None)
        }

        async fn list_accounts(
            &self,
            _external_user_id: &str,
            app_slug: &str,
        ) -> anyhow::Result<Vec<PipedreamAccount>> {
            self.called(format!("list_accounts {app_slug}"));
            Ok(Vec::new())
        }

        async fn delete_account(&self, account_id: &str) -> anyhow::Result<()> {
            self.called(format!("delete_account {account_id}"));
            Ok(())
        }
    }

    impl ConnectorDirectory for Fake {
        async fn search(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            _search: Option<&str>,
            _cursor: Option<&str>,
            _limit: u32,
        ) -> anyhow::Result<CatalogPage> {
            self.called("search");
            Ok(CatalogPage {
                entries: vec![CatalogEntry {
                    app_slug: self.name.to_owned(),
                    display_name: self.name.to_owned(),
                    description: None,
                    icon_url: None,
                    categories: Vec::new(),
                }],
                next_cursor: None,
            })
        }

        async fn retrieve(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            app_slug: &str,
        ) -> anyhow::Result<Option<CatalogEntry>> {
            self.called(format!("retrieve {app_slug}"));
            Ok(None)
        }
    }

    /// Connect serves Linear, connected for everyone: asked, it would answer
    /// in a way that shows up in the response.
    impl MacroConnect for Fake {
        async fn connect_only(&self, _user_id: &MacroUserIdStr<'static>) -> bool {
            self.called("connect_only");
            true
        }

        async fn app_for_slug(&self, app_slug: &str) -> anyhow::Result<Option<ConnectApp>> {
            self.called(format!("app_for_slug {app_slug}"));
            Ok((app_slug == "linear").then(|| ConnectApp {
                app_id: "connect-linear".to_owned(),
                app_slug: app_slug.to_owned(),
                name: "Linear".to_owned(),
            }))
        }

        async fn create_connect_session(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            app: &ConnectApp,
        ) -> anyhow::Result<String> {
            self.called(format!("create_connect_session {}", app.app_slug));
            Ok("https://connect.test/session".to_owned())
        }

        async fn is_connected(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            app_id: &str,
        ) -> anyhow::Result<bool> {
            self.called(format!("is_connected {app_id}"));
            Ok(true)
        }

        async fn delete_connection(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            app_id: &str,
        ) -> anyhow::Result<()> {
            self.called(format!("delete_connection {app_id}"));
            Ok(())
        }
    }

    impl McpUpstream for Fake {
        async fn upstream(&self, _record: &PipedreamConnection) -> anyhow::Result<McpUpstreamCall> {
            self.called("upstream");
            Ok(McpUpstreamCall {
                url: Url::parse(&format!("https://{}.test/mcp", self.name)).unwrap(),
                bearer_token: self.name.into(),
                headers: Default::default(),
            })
        }
    }

    #[derive(Clone, Default)]
    struct FakeStore {
        records: Arc<Mutex<Vec<PipedreamConnection>>>,
    }

    impl FakeStore {
        fn rows(&self) -> Vec<(String, ConnectionProvider, String, bool)> {
            self.records
                .lock()
                .unwrap()
                .iter()
                .map(|record| {
                    (
                        record.app_slug.clone(),
                        record.provider,
                        record.account_id.clone(),
                        record.enabled,
                    )
                })
                .collect()
        }
    }

    impl ConnectionStore for FakeStore {
        type Err = anyhow::Error;

        async fn save(&self, record: &PipedreamConnection) -> Result<(), Self::Err> {
            let mut records = self.records.lock().unwrap();
            records.retain(|row| row.app_slug != record.app_slug);
            records.push(record.clone());
            Ok(())
        }

        async fn load(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            app_slug: &str,
        ) -> Result<Option<PipedreamConnection>, Self::Err> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .iter()
                .find(|row| row.app_slug == app_slug)
                .cloned())
        }

        async fn delete(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            app_slug: &str,
        ) -> Result<(), Self::Err> {
            self.records
                .lock()
                .unwrap()
                .retain(|row| row.app_slug != app_slug);
            Ok(())
        }

        async fn list(
            &self,
            _user_id: &MacroUserIdStr<'static>,
        ) -> Result<Vec<PipedreamConnection>, Self::Err> {
            Ok(self.records.lock().unwrap().clone())
        }
    }

    impl ConnectorOverlays for FakeStore {
        async fn overlays(&self) -> anyhow::Result<Vec<ConnectorOverlay>> {
            Ok(Vec::new())
        }

        async fn overlay(&self, _app_slug: &str) -> anyhow::Result<Option<ConnectorOverlay>> {
            Ok(None)
        }
    }

    fn pipedream_row(app_slug: &str, server_name: &str, enabled: bool) -> PipedreamConnection {
        PipedreamConnection {
            user_id: user_id(),
            app_slug: app_slug.to_owned(),
            server_name: server_name.to_owned(),
            account_id: format!("apn_{app_slug}"),
            enabled,
            provider: ConnectionProvider::Pipedream,
        }
    }

    /// An enabled row Connect serves, one it doesn't, and a disabled one.
    fn store() -> FakeStore {
        FakeStore {
            records: Arc::new(Mutex::new(vec![
                pipedream_row("linear", "Linear", true),
                pipedream_row("todoist", "Todoist", true),
                pipedream_row("notion", "Notion", false),
            ])),
        }
    }

    fn rollout(on: bool) -> ConnectRollout {
        Arc::new(move |_| Box::pin(async move { on }))
    }

    struct World {
        pipedream: Fake,
        connect: Fake,
        store: FakeStore,
        backends: Arc<ConnectorBackends<Fake, Fake>>,
    }

    impl World {
        fn new(connect_configured: bool, rollout: Option<ConnectRollout>) -> Self {
            let pipedream = Fake::new("pipedream");
            let connect = Fake::new("connect");
            let mut backends = ConnectorBackends::new(
                Arc::new(pipedream.clone()),
                connect_configured.then(|| Arc::new(connect.clone())),
            );
            if let Some(rollout) = rollout {
                backends = backends.with_rollout(rollout);
            }
            Self {
                pipedream,
                connect,
                store: store(),
                backends: Arc::new(backends),
            }
        }

        /// Every way production answers "not on Connect": the flag off for
        /// this user, no PostHog key, no Connect customer key.
        fn all_flag_off() -> [Self; 3] {
            [
                Self::new(true, Some(rollout(false))),
                Self::new(true, None),
                Self::new(false, Some(rollout(false))),
            ]
        }

        fn flag_on() -> Self {
            Self::new(true, Some(rollout(true)))
        }

        async fn send(&self, request: Request<Body>) -> (StatusCode, Value) {
            let state = PipedreamRouterState::new(
                self.store.clone(),
                Some(self.backends.clone()),
                MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
            );
            send(pipedream_mcp_router(state), request).await
        }
    }

    async fn send(router: axum::Router, request: Request<Body>) -> (StatusCode, Value) {
        let response = router.oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }

    fn request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
        let builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, "Bearer jwt")
            .header(header::CONTENT_TYPE, "application/json");
        builder
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        request("GET", uri, None)
    }

    fn slugs(body: &Value) -> Vec<&str> {
        body.as_array()
            .unwrap()
            .iter()
            .map(|row| row["app_slug"].as_str().unwrap())
            .collect()
    }

    #[tokio::test]
    async fn reconnects_prompts_nothing_and_never_asks_connect() {
        for world in World::all_flag_off() {
            let (status, body) = world.send(get("/pipedream/mcp/reconnects")).await;

            assert_eq!(status, StatusCode::OK);
            assert_eq!(body, json!([]));
            assert_eq!(world.connect.calls(), Vec::<String>::new());
            assert_eq!(world.pipedream.calls(), Vec::<String>::new());
        }
    }

    #[tokio::test]
    async fn reconnects_prompts_nothing_without_pipedream_configured() {
        let world = World::new(true, Some(rollout(false)));
        let state = PipedreamRouterState::<_, ConnectorBackends<Fake, Fake>, _>::new(
            world.store.clone(),
            None,
            MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
        );

        let (status, body) = send(
            pipedream_mcp_router(state),
            get("/pipedream/mcp/reconnects"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!([]));
    }

    /// The control: the same fixture prompts once the flag is on.
    #[tokio::test]
    async fn reconnects_prompts_for_the_same_rows_with_the_flag_on() {
        let world = World::flag_on();

        let (status, body) = world.send(get("/pipedream/mcp/reconnects")).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(slugs(&body), ["linear"]);
    }

    #[tokio::test]
    async fn connections_still_list_as_pipedream_and_reach_pipedream() {
        for world in World::all_flag_off() {
            let (status, body) = world.send(get("/pipedream/mcp/connections")).await;

            assert_eq!(status, StatusCode::OK);
            assert_eq!(
                body,
                json!([
                    {"app_slug": "linear", "server_name": "Linear", "enabled": true, "provider": "pipedream"},
                    {"app_slug": "todoist", "server_name": "Todoist", "enabled": true, "provider": "pipedream"},
                    {"app_slug": "notion", "server_name": "Notion", "enabled": false, "provider": "pipedream"},
                ])
            );

            // Each listed row calls Pipedream, not a refusal to reconnect.
            for record in world.store.list(&user_id()).await.unwrap() {
                let call = world.backends.upstream(&record).await.unwrap();
                assert_eq!(call.bearer_token, "pipedream");
            }
            assert_eq!(world.connect.calls(), Vec::<String>::new());
        }
    }

    /// The control: the flag on hides those rows and refuses them.
    #[tokio::test]
    async fn the_same_rows_are_hidden_and_refused_with_the_flag_on() {
        let world = World::flag_on();

        let (_, body) = world.send(get("/pipedream/mcp/connections")).await;

        assert_eq!(body, json!([]));
        let record = pipedream_row("linear", "Linear", true);
        assert!(world.backends.upstream(&record).await.is_err());
    }

    #[tokio::test]
    async fn connecting_still_starts_pipedream() {
        for world in World::all_flag_off() {
            let (status, body) = world
                .send(request(
                    "POST",
                    "/pipedream/mcp/token",
                    Some(json!({"app_slug": "linear"})),
                ))
                .await;

            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["provider"], "pipedream");
            assert_eq!(body["token"], "ctok_test");
            assert_eq!(body["connect_url"], Value::Null);
            assert_eq!(world.connect.calls(), Vec::<String>::new());
        }
    }

    #[tokio::test]
    async fn the_catalog_is_still_pipedreams() {
        for world in World::all_flag_off() {
            let (status, body) = world.send(get("/pipedream/mcp/catalog")).await;

            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["servers"][0]["app_slug"], "pipedream");
            assert_eq!(world.connect.calls(), Vec::<String>::new());
        }
    }

    /// The only path that overwrites a Pipedream row and revokes its grant.
    #[tokio::test]
    async fn completing_a_connect_flow_is_refused_and_keeps_the_grant() {
        for world in World::all_flag_off() {
            let before = world.store.rows();

            let (status, _) = world
                .send(request(
                    "POST",
                    "/pipedream/mcp/connect/complete",
                    Some(json!({"app_slug": "linear"})),
                ))
                .await;

            assert_eq!(status, StatusCode::NOT_FOUND);
            assert_eq!(world.store.rows(), before);
            assert_eq!(world.pipedream.calls(), Vec::<String>::new());
            assert_eq!(world.connect.calls(), Vec::<String>::new());
        }
    }

    /// The control: the flag on overwrites the row and revokes the grant.
    #[tokio::test]
    async fn completing_a_connect_flow_moves_the_row_with_the_flag_on() {
        let world = World::flag_on();

        let (status, body) = world
            .send(request(
                "POST",
                "/pipedream/mcp/connect/complete",
                Some(json!({"app_slug": "linear"})),
            ))
            .await;

        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["provider"], "connect");
        assert!(
            world
                .pipedream
                .calls()
                .contains(&"delete_account apn_linear".to_owned()),
            "{:?}",
            world.pipedream.calls()
        );
    }

    #[tokio::test]
    async fn disconnecting_still_revokes_at_pipedream() {
        for world in World::all_flag_off() {
            let (status, _) = world
                .send(request(
                    "DELETE",
                    "/pipedream/mcp/connections?app_slug=linear",
                    None,
                ))
                .await;

            assert_eq!(status, StatusCode::NO_CONTENT);
            assert!(
                world
                    .pipedream
                    .calls()
                    .contains(&"delete_account apn_linear".to_owned()),
                "{:?}",
                world.pipedream.calls()
            );
            assert_eq!(world.connect.calls(), Vec::<String>::new());
            assert!(
                !world
                    .store
                    .rows()
                    .iter()
                    .any(|(app_slug, ..)| app_slug == "linear")
            );
        }
    }
}
