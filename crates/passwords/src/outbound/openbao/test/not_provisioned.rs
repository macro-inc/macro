use super::*;
use axum::{Router, http::StatusCode, routing::any};

/// A throwaway RS256 key: the fake server never verifies the login JWT.
fn signing_key() -> String {
    use rsa::pkcs1::{EncodeRsaPrivateKey, LineEnding};
    rsa::RsaPrivateKey::new(&mut rsa::rand_core::OsRng, 2048)
        .expect("synthetic key")
        .to_pkcs1_pem(LineEnding::LF)
        .expect("synthetic key PEM")
        .to_string()
}

/// A fake OpenBao answering login with `login` and every other request with
/// `other`, both as `(status, body)`.
async fn fake_openbao(
    login: (StatusCode, &'static str),
    other: (StatusCode, &'static str),
) -> (OpenBaoProvider, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/v1/auth/macro/login", any(move || async move { login }))
                .fallback(any(move || async move { other })),
        )
        .await
        .expect("server")
    });
    let provider = OpenBaoProvider::new(
        format!("http://{address}"),
        "macro-local-passwords".into(),
        &signing_key(),
    )
    .expect("provider");
    (provider, server)
}

#[tokio::test]
async fn missing_team_namespace_at_login_is_not_provisioned() {
    let (provider, server) = fake_openbao(
        (
            StatusCode::NOT_FOUND,
            r#"{"errors":["namespace not found"]}"#,
        ),
        (StatusCode::INTERNAL_SERVER_ERROR, r#"{"errors":[]}"#),
    )
    .await;
    let team = TeamId(uuid::Uuid::now_v7());
    let item = ItemId(uuid::Uuid::now_v7());

    let result = provider.current_version(team, item).await;

    server.abort();
    assert!(matches!(result, Err(Error::NotProvisioned)));
}

#[tokio::test]
async fn missing_item_after_login_stays_not_found() {
    let (provider, server) = fake_openbao(
        (
            StatusCode::OK,
            r#"{"auth":{"client_token":"synthetic-token","lease_duration":60}}"#,
        ),
        (StatusCode::NOT_FOUND, r#"{"errors":[]}"#),
    )
    .await;
    let team = TeamId(uuid::Uuid::now_v7());
    let item = ItemId(uuid::Uuid::now_v7());

    let result = provider.current_version(team, item).await;

    server.abort();
    assert!(matches!(result, Ok(None)));
}

#[tokio::test]
async fn other_login_failures_stay_unavailable() {
    let (provider, server) = fake_openbao(
        (StatusCode::FORBIDDEN, r#"{"errors":["permission denied"]}"#),
        (StatusCode::INTERNAL_SERVER_ERROR, r#"{"errors":[]}"#),
    )
    .await;
    let team = TeamId(uuid::Uuid::now_v7());
    let item = ItemId(uuid::Uuid::now_v7());

    let result = provider.current_version(team, item).await;

    server.abort();
    assert!(matches!(result, Err(Error::Unavailable)));
}
