use super::*;
use axum::{
    Router,
    extract::Query,
    routing::{get, post},
};

#[tokio::test]
async fn absent_and_empty_usernames_read_as_empty_but_malformed_values_fail() {
    let key = Command::new("openssl")
        .args([
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:2048",
        ])
        .output()
        .expect("synthetic signing key");
    assert!(key.status.success());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let app = Router::new()
        .route("/v1/auth/macro/login", post(|| async {
            axum::Json(serde_json::json!({"auth":{"client_token":"synthetic-token","lease_duration":60}}))
        }))
        .route("/v1/passwords/data/{item}", get(|Query(query): Query<std::collections::HashMap<String, u64>>| async move {
            let version = query["version"];
            let values = match version {
                1 => serde_json::json!({"password":"synthetic-secret","notes":"","fields":[]}),
                2 => serde_json::json!({"username":""}),
                _ => serde_json::json!({"username":null}),
            };
            axum::Json(serde_json::json!({"data":{"data":{"values":values},"metadata":{"created_time":"2026-01-01T00:00:00Z","deletion_time":"","destroyed":false,"version":version}}}))
        }));
    let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("server") });
    let provider = OpenBaoProvider::new(
        format!("http://{address}"),
        "synthetic-issuer".into(),
        &String::from_utf8(key.stdout).expect("PEM"),
    )
    .expect("provider");
    let team = TeamId(uuid::Uuid::now_v7());
    let item = ItemId(uuid::Uuid::now_v7());
    for version in [1, 2] {
        assert!(
            provider
                .username(team, item, version)
                .await
                .expect("empty identifier")
                .0
                .is_empty()
        );
    }
    assert!(matches!(
        provider.username(team, item, 3).await,
        Err(Error::Unavailable)
    ));
    server.abort();
    let _ = server.await;
}
