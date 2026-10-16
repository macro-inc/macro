//! Round-trip tests for the Redis adapter against a live local Redis.
//!
//! Start it with `bash .cursor/infra.sh` (or `just run_dbs -d`), then run
//! `cargo test -p mcp_auth_proxy --all-features -- --ignored`.

use redis::AsyncCommands;
use std::time::{Duration, UNIX_EPOCH};

use super::*;
use crate::domain::models::{AccessToken, RefreshToken};

const LOCAL_REDIS_URL: &str = "redis://127.0.0.1:6379/";

fn client() -> redis::Client {
    redis::Client::open(LOCAL_REDIS_URL).expect("local redis url should parse")
}

fn unique(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4())
}

fn registered_client(client_id: &str) -> RegisteredClient {
    RegisteredClient {
        client_id: client_id.to_owned(),
        client_name: "test-client".to_owned(),
        redirect_uris: vec![
            "https://claude.ai/api/mcp/auth_callback".to_owned(),
            "http://127.0.0.1:51000/oauth/callback".to_owned(),
        ],
    }
}

#[tokio::test]
#[ignore = "requires a local Redis"]
async fn client_registration_round_trips() {
    let registry = RedisClientRegistry::new(client());
    let client_id = unique("client");

    assert!(
        registry
            .find_client(&client_id)
            .await
            .expect("lookup should succeed")
            .is_none(),
        "an unregistered client_id must not resolve"
    );

    registry
        .insert_client(&registered_client(&client_id))
        .await
        .expect("insert should succeed");

    let found = registry
        .find_client(&client_id)
        .await
        .expect("lookup should succeed")
        .expect("the registration should be readable");

    assert_eq!(found.client_id, client_id);
    assert_eq!(found.client_name, "test-client");
    assert_eq!(
        found.redirect_uris,
        vec![
            "https://claude.ai/api/mcp/auth_callback",
            "http://127.0.0.1:51000/oauth/callback"
        ]
    );
}

/// The lookup uses `GETEX ... EX`, so reading a registration must push its
/// expiry back out to the full window.
#[tokio::test]
#[ignore = "requires a local Redis"]
async fn looking_up_a_client_re_arms_its_ttl() {
    let redis_client = client();
    let registry = RedisClientRegistry::new(redis_client.clone());
    let client_id = unique("client-ttl");
    let key = RedisClientRegistry::client_key(&client_id);

    registry
        .insert_client(&registered_client(&client_id))
        .await
        .expect("insert should succeed");

    let mut conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .expect("redis should be reachable");
    conn.expire::<&str, ()>(&key, 5)
        .await
        .expect("expire should succeed");
    let shortened: i64 = conn.ttl(&key).await.expect("ttl should succeed");
    assert!(shortened <= 5, "TTL was not shortened: {shortened}");

    registry
        .find_client(&client_id)
        .await
        .expect("lookup should succeed")
        .expect("the registration should still be there");

    let re_armed: i64 = conn.ttl(&key).await.expect("ttl should succeed");
    assert!(
        re_armed > 5,
        "lookup did not re-arm the TTL, still {re_armed}"
    );
}

#[tokio::test]
#[ignore = "requires a local Redis"]
async fn refresh_token_binding_round_trips() {
    let registry = RedisClientRegistry::new(client());
    let digest = unique("digest");
    let client_id = unique("client-binding");

    assert!(
        registry
            .bound_client(&digest)
            .await
            .expect("lookup should succeed")
            .is_none(),
        "an unbound digest must not resolve"
    );

    registry
        .bind(&digest, &client_id)
        .await
        .expect("bind should succeed");
    assert_eq!(
        registry
            .bound_client(&digest)
            .await
            .expect("lookup should succeed"),
        Some(client_id)
    );

    registry
        .unbind(&digest)
        .await
        .expect("unbind should succeed");
    assert!(
        registry
            .bound_client(&digest)
            .await
            .expect("lookup should succeed")
            .is_none(),
        "an unbound digest must not resolve"
    );
}

/// Handshake state carries the client id now, so the stored form has to survive
/// a round trip with it.
#[tokio::test]
#[ignore = "requires a local Redis"]
async fn handshake_state_round_trips_with_its_client_id() {
    let inflight = RedisInflightAuth::new(client());
    let session_id = unique("session");
    let code = unique("code");

    inflight
        .insert_pending(
            &session_id,
            PendingAuthorization {
                client_id: "client-abc".to_owned(),
                code_challenge: "challenge".to_owned(),
                client_state: "state".to_owned(),
                client_redirect_uri: "https://claude.ai/api/mcp/auth_callback".to_owned(),
            },
        )
        .await
        .expect("insert should succeed");

    let pending = inflight
        .take_pending(&session_id)
        .await
        .expect("take should succeed")
        .expect("the pending flow should be readable");
    assert_eq!(pending.client_id, "client-abc");
    assert!(
        inflight
            .take_pending(&session_id)
            .await
            .expect("take should succeed")
            .is_none(),
        "a pending flow must be single-use"
    );

    // Stored as unix seconds, so the round trip is only accurate to a second.
    let expires_at = UNIX_EPOCH + Duration::from_secs(2_000_000_000);
    inflight
        .insert_issued(
            &code,
            IssuedAuthorizationCode {
                client_id: "client-abc".to_owned(),
                access_token: AccessToken::from("access"),
                refresh_token: RefreshToken::from("refresh"),
                code_challenge: "challenge".to_owned(),
                redirect_uri: "https://claude.ai/api/mcp/auth_callback".to_owned(),
                access_token_expires_at: Some(expires_at),
            },
        )
        .await
        .expect("insert should succeed");

    let issued = inflight
        .take_issued(&code)
        .await
        .expect("take should succeed")
        .expect("the issued code should be readable");
    assert_eq!(issued.client_id, "client-abc");
    assert_eq!(issued.access_token.as_str(), "access");
    assert_eq!(issued.access_token_expires_at, Some(expires_at));
    assert!(
        inflight
            .take_issued(&code)
            .await
            .expect("take should succeed")
            .is_none(),
        "an issued code must be single-use"
    );
}
