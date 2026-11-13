use super::*;
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use std::{
    collections::{HashMap, HashSet},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

const CREATED: &str = "2026-01-01T00:00:00Z";

/// A fake OpenBao that issues numbered tokens bound to the login namespace
/// and records which token and namespace each value request presented.
#[derive(Default)]
struct Provider {
    logins: AtomicUsize,
    lifecycle_logins: AtomicUsize,
    value_requests: AtomicUsize,
    omit_lease: AtomicBool,
    deny_all: AtomicBool,
    issued: Mutex<HashMap<String, String>>,
    presented: Mutex<Vec<(String, String)>>,
    revoked: Mutex<HashSet<String>>,
    /// The next value request whose path contains this revokes its token.
    revoke_on: Mutex<Option<&'static str>>,
    revoked_status: Mutex<Option<StatusCode>>,
    /// The next value request fails with this response, without touching tokens.
    fail_once: Mutex<Option<(StatusCode, &'static str)>>,
    operation: Mutex<Option<uuid::Uuid>>,
}

fn errors(status: StatusCode, message: &str) -> Response {
    (
        status,
        axum::Json(serde_json::json!({ "errors": [message] })),
    )
        .into_response()
}

async fn route(
    State(provider): State<Arc<Provider>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned()
    };
    let path = uri.path();
    if path == "/v1/auth/macro/login" {
        let login = provider.logins.fetch_add(1, Ordering::SeqCst) + 1;
        let token = format!("synthetic-token-{login}");
        provider
            .issued
            .lock()
            .expect("issued")
            .insert(token.clone(), header("X-Vault-Namespace"));
        let auth = if provider.omit_lease.load(Ordering::SeqCst) {
            serde_json::json!({ "client_token": token })
        } else {
            serde_json::json!({ "client_token": token, "lease_duration": 60 })
        };
        return axum::Json(serde_json::json!({ "auth": auth })).into_response();
    }
    if path == "/v1/auth/macro-lifecycle/login" {
        let login = provider.lifecycle_logins.fetch_add(1, Ordering::SeqCst) + 1;
        return axum::Json(serde_json::json!({"auth":{"client_token":format!("synthetic-lifecycle-{login}"),"lease_duration":60}}))
            .into_response();
    }
    if path.starts_with("/v1/sys/namespaces/") {
        return if method == Method::DELETE {
            StatusCode::NO_CONTENT.into_response()
        } else {
            errors(StatusCode::NOT_FOUND, "namespace not found")
        };
    }
    provider.value_requests.fetch_add(1, Ordering::SeqCst);
    let token = header("X-Vault-Token");
    provider
        .presented
        .lock()
        .expect("presented")
        .push((token.clone(), header("X-Vault-Namespace")));
    let revoked_status = provider
        .revoked_status
        .lock()
        .expect("status")
        .unwrap_or(StatusCode::FORBIDDEN);
    {
        let mut revoke_on = provider.revoke_on.lock().expect("revoke_on");
        if revoke_on.is_some_and(|fragment| path.contains(fragment)) {
            *revoke_on = None;
            provider
                .revoked
                .lock()
                .expect("revoked")
                .insert(token.clone());
        }
    }
    if provider.deny_all.load(Ordering::SeqCst)
        || provider.revoked.lock().expect("revoked").contains(&token)
    {
        return errors(revoked_status, "permission denied");
    }
    if let Some((status, message)) = provider.fail_once.lock().expect("fail").take() {
        return errors(status, message);
    }
    let version = serde_json::json!({"created_time":CREATED,"deletion_time":"","destroyed":false,"version":1});
    match (method, path) {
        (Method::GET, path) if path.starts_with("/v1/passwords/metadata/") => {
            axum::Json(serde_json::json!({"data":{"current_version":1,"versions":{"1":version}}}))
                .into_response()
        }
        (Method::GET, path) if path.starts_with("/v1/passwords/data/") => {
            let operation = provider
                .operation
                .lock()
                .expect("operation")
                .unwrap_or_default();
            axum::Json(serde_json::json!({"data":{"data":{"operation_id":operation,"values":{"username":"synthetic-user","password":"synthetic-password","notes":"","fields":[]}},"metadata":version}}))
                .into_response()
        }
        (Method::POST, path) if path.starts_with("/v1/passwords/data/") => {
            axum::Json(serde_json::json!({"data":{"version":2,"created_time":CREATED}}))
                .into_response()
        }
        (Method::POST, path) if path.starts_with("/v1/passwords/destroy/") => {
            StatusCode::NO_CONTENT.into_response()
        }
        _ => errors(StatusCode::NOT_FOUND, "unexpected fixture route"),
    }
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

impl Fixture {
    fn logins(&self) -> usize {
        self.state.logins.load(Ordering::SeqCst)
    }

    fn value_requests(&self) -> usize {
        self.state.value_requests.load(Ordering::SeqCst)
    }

    fn revoke_on(&self, fragment: &'static str, status: StatusCode) {
        *self.state.revoke_on.lock().expect("revoke_on") = Some(fragment);
        *self.state.revoked_status.lock().expect("status") = Some(status);
    }

    fn fail_once(&self, status: StatusCode, message: &'static str) {
        *self.state.fail_once.lock().expect("fail") = Some((status, message));
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
    let app = Router::new().fallback(route).with_state(state.clone());
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

fn team() -> TeamId {
    TeamId(uuid::Uuid::now_v7())
}

async fn write_item(fixture: &Fixture, team: TeamId) -> Result<i32, Error> {
    fixture
        .provider
        .write(
            team,
            ItemId(uuid::Uuid::now_v7()),
            1,
            uuid::Uuid::now_v7(),
            &values(),
        )
        .await
}

#[tokio::test]
async fn one_login_serves_many_writes_per_team() {
    let fixture = fixture().await;
    let (first, second) = (team(), team());
    for _ in 0..25 {
        write_item(&fixture, first).await.expect("write");
    }
    assert_eq!(fixture.logins(), 1);
    write_item(&fixture, second).await.expect("other team");
    write_item(&fixture, first).await.expect("first team again");
    assert_eq!(
        fixture.logins(),
        2,
        "another team never reuses the first team's token"
    );
}

#[tokio::test]
async fn cached_tokens_are_only_presented_to_their_own_namespace() {
    let fixture = fixture().await;
    let teams = [team(), team(), team()];
    for _ in 0..3 {
        for team in teams {
            write_item(&fixture, team).await.expect("write");
        }
    }
    let issued = fixture.state.issued.lock().expect("issued");
    let presented = fixture.state.presented.lock().expect("presented");
    assert_eq!(issued.len(), 3);
    assert_eq!(presented.len(), 9);
    for (token, namespace) in presented.iter() {
        assert_eq!(issued.get(token), Some(namespace));
    }
    let namespaces: HashSet<_> = issued.values().cloned().collect();
    let expected: HashSet<_> = teams
        .iter()
        .map(|team| format!("team-{}", team.0))
        .collect();
    assert_eq!(namespaces, expected);
}

#[tokio::test]
async fn rejected_cached_token_is_replaced_once() {
    for status in [StatusCode::FORBIDDEN, StatusCode::UNAUTHORIZED] {
        let fixture = fixture().await;
        let team = team();
        write_item(&fixture, team).await.expect("first write");
        fixture.revoke_on("/passwords/data/", status);
        write_item(&fixture, team)
            .await
            .expect("retried with a fresh token");
        assert_eq!(fixture.logins(), 2, "{status}");
        assert_eq!(fixture.value_requests(), 3, "{status}");
        write_item(&fixture, team)
            .await
            .expect("fresh token cached");
        assert_eq!(fixture.logins(), 2, "{status}");
    }
}

#[tokio::test]
async fn a_token_revoked_mid_delete_reruns_the_whole_delete_once() {
    let fixture = fixture().await;
    let team = team();
    write_item(&fixture, team).await.expect("cache a token");
    fixture.revoke_on("/passwords/destroy/", StatusCode::FORBIDDEN);
    fixture
        .provider
        .delete(team, ItemId(uuid::Uuid::now_v7()))
        .await
        .expect("delete reruns after the destroy step is rejected");
    assert_eq!(fixture.logins(), 2);
    // write; metadata, tombstone, rejected destroy; metadata, tombstone, destroy.
    assert_eq!(fixture.value_requests(), 7);
}

#[tokio::test]
async fn a_token_revoked_mid_status_reruns_the_lookup_once() {
    let fixture = fixture().await;
    let team = team();
    let operation = uuid::Uuid::now_v7();
    *fixture.state.operation.lock().expect("operation") = Some(operation);
    write_item(&fixture, team).await.expect("cache a token");
    fixture.revoke_on("/passwords/data/", StatusCode::FORBIDDEN);
    assert_eq!(
        fixture
            .provider
            .status(team, ItemId(uuid::Uuid::now_v7()))
            .await
            .expect("status"),
        Some((1, operation))
    );
    assert_eq!(fixture.logins(), 2);
    // write; metadata, rejected read; metadata, read.
    assert_eq!(fixture.value_requests(), 5);
}

#[tokio::test]
async fn policy_denial_is_retried_at_most_once_and_keeps_the_fresh_token() {
    let fixture = fixture().await;
    let team = team();
    write_item(&fixture, team).await.expect("first write");
    fixture.state.deny_all.store(true, Ordering::SeqCst);
    assert!(matches!(
        write_item(&fixture, team).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(fixture.logins(), 2);
    assert_eq!(fixture.value_requests(), 3);
    // The replacement was freshly issued, so its denial is policy: it stays
    // cached and the next denied call costs one more login, not a loop.
    assert!(matches!(
        write_item(&fixture, team).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(fixture.logins(), 3);
    assert_eq!(fixture.value_requests(), 5);
    fixture.state.deny_all.store(false, Ordering::SeqCst);
    write_item(&fixture, team).await.expect("policy restored");
    assert_eq!(fixture.logins(), 3, "the denied token was never evicted");
}

#[tokio::test]
async fn a_freshly_issued_token_that_is_denied_is_not_retried() {
    let fixture = fixture().await;
    fixture.state.deny_all.store(true, Ordering::SeqCst);
    assert!(matches!(
        write_item(&fixture, team()).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(fixture.logins(), 1);
    assert_eq!(fixture.value_requests(), 1);
}

#[tokio::test]
async fn non_authentication_failures_keep_the_cached_token() {
    let fixture = fixture().await;
    let team = team();
    write_item(&fixture, team).await.expect("cache a token");
    for (status, message, expected) in [
        (StatusCode::INTERNAL_SERVER_ERROR, "internal", "unavailable"),
        (StatusCode::TOO_MANY_REQUESTS, "rate limited", "unavailable"),
        (StatusCode::NOT_FOUND, "missing", "unavailable"),
        (
            StatusCode::BAD_REQUEST,
            "check-and-set parameter did not match the current version",
            "conflict",
        ),
    ] {
        fixture.fail_once(status, message);
        let outcome = write_item(&fixture, team).await;
        assert!(
            match expected {
                "conflict" => matches!(outcome, Err(Error::Conflict)),
                _ => matches!(outcome, Err(Error::Unavailable)),
            },
            "{status}"
        );
    }
    write_item(&fixture, team).await.expect("still cached");
    assert_eq!(fixture.logins(), 1);
    assert_eq!(fixture.value_requests(), 6, "failures are never retried");
}

#[tokio::test]
async fn a_login_without_a_lease_fails_closed() {
    let fixture = fixture().await;
    fixture.state.omit_lease.store(true, Ordering::SeqCst);
    assert!(matches!(
        write_item(&fixture, team()).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(fixture.value_requests(), 0);
}

#[tokio::test]
async fn namespace_purge_never_uses_the_value_token_cache() {
    let fixture = fixture().await;
    let team = team();
    write_item(&fixture, team)
        .await
        .expect("cache a value token");
    for _ in 0..2 {
        fixture.provider.purge_namespace(team).await.expect("purge");
    }
    assert_eq!(fixture.state.lifecycle_logins.load(Ordering::SeqCst), 2);
    assert_eq!(fixture.logins(), 1);
    assert!(
        fixture
            .state
            .presented
            .lock()
            .expect("presented")
            .iter()
            .all(|(token, _)| token == "synthetic-token-1"),
        "lifecycle tokens never reach value requests"
    );
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
    let team = team();
    async {
        tracing::info!("capture-active");
        write_item(&fixture, team).await.expect("login write");
        fixture.revoke_on("/passwords/data/", StatusCode::FORBIDDEN);
        write_item(&fixture, team).await.expect("retried write");
    }
    .with_subscriber(subscriber)
    .await;
    let logs = buffer.0.lock().expect("logs");
    let logs = String::from_utf8_lossy(&logs);
    assert!(logs.contains("capture-active"));
    assert!(!logs.contains("synthetic-token"));
}
