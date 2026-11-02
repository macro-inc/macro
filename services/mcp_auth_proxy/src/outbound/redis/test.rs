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
    let binding = RefreshTokenBinding {
        client_id: unique("client-binding"),
        grant_id: unique("grant"),
    };

    assert!(
        registry
            .binding(&digest)
            .await
            .expect("lookup should succeed")
            .is_none(),
        "an unbound digest must not resolve"
    );

    registry
        .bind(&digest, &binding)
        .await
        .expect("bind should succeed");
    assert_eq!(
        registry
            .binding(&digest)
            .await
            .expect("lookup should succeed"),
        Some(binding)
    );

    registry
        .unbind(&digest)
        .await
        .expect("unbind should succeed");
    assert!(
        registry
            .binding(&digest)
            .await
            .expect("lookup should succeed")
            .is_none(),
        "an unbound digest must not resolve"
    );
}

#[tokio::test]
#[ignore = "requires a local Redis"]
async fn grant_revocation_round_trips() {
    let registry = RedisClientRegistry::new(client());
    let grant_id = unique("grant");

    assert!(
        !registry
            .is_grant_revoked(&grant_id)
            .await
            .expect("lookup should succeed")
    );
    registry
        .revoke_grant(&grant_id)
        .await
        .expect("revocation should succeed");
    assert!(
        registry
            .is_grant_revoked(&grant_id)
            .await
            .expect("lookup should succeed")
    );
}

/// Bindings written before grants were tracked hold the bare client id. They
/// must keep working, each as a family named by its own digest.
#[test]
fn binding_without_a_grant_becomes_its_own_family() {
    let binding = parse_refresh_token_binding(
        "legacy-digest",
        "0b8f3c1e-6a59-4bd5-9b0e-3f8d4c2a1e77".to_owned(),
    )
    .expect("a bare client id should parse");

    assert_eq!(
        binding,
        RefreshTokenBinding {
            client_id: "0b8f3c1e-6a59-4bd5-9b0e-3f8d4c2a1e77".to_owned(),
            grant_id: "legacy-digest".to_owned(),
        }
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
                access_token_expires_at: expires_at,
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
    assert_eq!(issued.access_token_expires_at, expires_at);
    assert!(
        inflight
            .take_issued(&code)
            .await
            .expect("take should succeed")
            .is_none(),
        "an issued code must be single-use"
    );
}

#[tokio::test]
#[ignore = "requires a local Redis"]
async fn export_returns_live_registrations_bindings_and_revocations_with_their_ttl() {
    let registry = RedisClientRegistry::new(client());
    let client_id = unique("client");
    let digest = unique("digest");
    let legacy_digest = unique("legacy-digest");
    let grant_id = unique("grant");
    let binding = RefreshTokenBinding {
        client_id: client_id.clone(),
        grant_id: grant_id.clone(),
    };
    registry
        .insert_client(&registered_client(&client_id))
        .await
        .expect("insert should succeed");
    registry
        .bind(&digest, &binding)
        .await
        .expect("bind should succeed");
    registry
        .revoke_grant(&grant_id)
        .await
        .expect("revoke should succeed");
    // A binding written before grants were tracked holds the bare client id.
    let mut conn = client()
        .get_multiplexed_async_connection()
        .await
        .expect("connect");
    conn.set_ex::<String, &str, ()>(
        RedisClientRegistry::refresh_binding_key(&legacy_digest),
        &client_id,
        60,
    )
    .await
    .expect("legacy bind should succeed");

    let clients = registry.export_clients().await.expect("export clients");
    let (exported, remaining) = clients
        .iter()
        .find(|(exported, _)| exported.client_id == client_id)
        .expect("the registration should be exported");
    assert_eq!(exported.client_name, "test-client");
    assert!(*remaining > CLIENT_REGISTRATION_TTL - Duration::from_secs(60));

    let bindings = registry.export_bindings().await.expect("export bindings");
    let (_, bound, remaining) = bindings
        .iter()
        .find(|(exported, _, _)| *exported == digest)
        .expect("the binding should be exported");
    assert_eq!(*bound, binding);
    assert!(*remaining > REFRESH_TOKEN_BINDING_TTL - Duration::from_secs(60));
    let (_, legacy, _) = bindings
        .iter()
        .find(|(exported, _, _)| *exported == legacy_digest)
        .expect("the legacy binding should be exported");
    assert_eq!(legacy.client_id, client_id);
    assert_eq!(legacy.grant_id, legacy_digest);

    let revoked = registry
        .export_revoked_grants()
        .await
        .expect("export revocations");
    let (_, remaining) = revoked
        .iter()
        .find(|(exported, _)| *exported == grant_id)
        .expect("the revocation should be exported");
    assert!(*remaining > REVOKED_GRANT_TTL - Duration::from_secs(60));
}
