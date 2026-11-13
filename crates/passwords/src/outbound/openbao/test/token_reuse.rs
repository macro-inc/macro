use super::*;
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
};
use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

#[derive(Default)]
struct Provider {
    logins: AtomicUsize,
    writes: AtomicUsize,
    revoked: Mutex<HashSet<String>>,
    deny_all: AtomicBool,
}

async fn login(State(provider): State<Arc<Provider>>) -> impl IntoResponse {
    let login = provider.logins.fetch_add(1, Ordering::SeqCst) + 1;
    axum::Json(
        serde_json::json!({"auth":{"client_token":format!("synthetic-token-{login}"),"lease_duration":60}}),
    )
}

async fn write(
    State(provider): State<Arc<Provider>>,
    headers: HeaderMap,
) -> axum::response::Response {
    let write = provider.writes.fetch_add(1, Ordering::SeqCst) + 1;
    let token = headers
        .get("X-Vault-Token")
        .and_then(|token| token.to_str().ok())
        .unwrap_or_default();
    if provider.deny_all.load(Ordering::SeqCst)
        || provider.revoked.lock().expect("revoked").contains(token)
    {
        return (StatusCode::FORBIDDEN, r#"{"errors":["permission denied"]}"#).into_response();
    }
    axum::Json(serde_json::json!({"data":{"version":write,"created_time":"2026-01-01T00:00:00Z"}}))
        .into_response()
}

struct Fixture {
    state: Arc<Provider>,
    provider: OpenBaoProvider,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn fixture() -> Fixture {
    let key = Command::new("openssl")
        .args([
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:2048",
        ])
        .output()
        .expect("synthetic RSA key generator");
    assert!(key.status.success());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let state = Arc::new(Provider::default());
    let app = Router::new()
        .route("/v1/auth/macro/login", post(login))
        .route("/v1/passwords/data/{*path}", post(write))
        .with_state(state.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("server") });
    let provider = OpenBaoProvider::new(
        format!("http://{address}"),
        "synthetic-issuer".into(),
        &String::from_utf8(key.stdout).expect("PEM"),
    )
    .expect("provider");
    Fixture {
        state,
        provider,
        server,
    }
}

fn values() -> SecretValues {
    SecretValues {
        username: SecretString("synthetic-user".into()),
        password: SecretString("synthetic-password".into()),
        notes: SecretString(String::new()),
        fields: vec![],
    }
}

async fn write_item(fixture: &Fixture, team: TeamId) -> Result<i32, Error> {
    fixture
        .provider
        .write(
            team,
            ItemId(uuid::Uuid::now_v7()),
            0,
            uuid::Uuid::now_v7(),
            &values(),
        )
        .await
}

#[tokio::test]
async fn one_login_serves_many_writes_per_team() {
    let fixture = fixture().await;
    let (first, second) = (TeamId(uuid::Uuid::now_v7()), TeamId(uuid::Uuid::now_v7()));
    for _ in 0..25 {
        write_item(&fixture, first).await.expect("write");
    }
    assert_eq!(fixture.state.logins.load(Ordering::SeqCst), 1);
    write_item(&fixture, second).await.expect("other team");
    assert_eq!(
        fixture.state.logins.load(Ordering::SeqCst),
        2,
        "another team never reuses the first team's token"
    );
}

#[tokio::test]
async fn rejected_cached_token_is_replaced_once() {
    let fixture = fixture().await;
    let team = TeamId(uuid::Uuid::now_v7());
    write_item(&fixture, team).await.expect("first write");
    fixture
        .state
        .revoked
        .lock()
        .expect("revoked")
        .insert("synthetic-token-1".into());
    write_item(&fixture, team)
        .await
        .expect("retried with a fresh token");
    assert_eq!(fixture.state.logins.load(Ordering::SeqCst), 2);
    assert_eq!(fixture.state.writes.load(Ordering::SeqCst), 3);
    write_item(&fixture, team)
        .await
        .expect("fresh token cached");
    assert_eq!(fixture.state.logins.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn denial_is_retried_at_most_once() {
    let fixture = fixture().await;
    let team = TeamId(uuid::Uuid::now_v7());
    write_item(&fixture, team).await.expect("first write");
    fixture.state.deny_all.store(true, Ordering::SeqCst);
    assert!(matches!(
        write_item(&fixture, team).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(fixture.state.logins.load(Ordering::SeqCst), 2);
    assert_eq!(fixture.state.writes.load(Ordering::SeqCst), 3);
    // A freshly issued token that is denied is not retried.
    assert!(matches!(
        write_item(&fixture, team).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(fixture.state.logins.load(Ordering::SeqCst), 3);
    assert_eq!(fixture.state.writes.load(Ordering::SeqCst), 4);
}

#[tokio::test]
async fn cached_tokens_never_reach_tracing() {
    let fixture = fixture().await;
    let buffer = LogBuffer(Arc::new(Mutex::new(vec![])));
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(buffer.clone())
        .finish();
    let team = TeamId(uuid::Uuid::now_v7());
    async {
        tracing::info!("capture-active");
        write_item(&fixture, team).await.expect("login write");
        fixture
            .state
            .revoked
            .lock()
            .expect("revoked")
            .insert("synthetic-token-1".into());
        write_item(&fixture, team).await.expect("retried write");
    }
    .with_subscriber(subscriber)
    .await;
    let logs = buffer.0.lock().expect("logs");
    let logs = String::from_utf8_lossy(&logs);
    assert!(logs.contains("capture-active"));
    assert!(!logs.contains("synthetic-token"));
}
