use std::{
    str::FromStr,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use macro_auth::middleware::decode_jwt::{JwtValidationArgs, MacroAccessToken};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, NoBotAuthorizer, NoUserApiKeyAuthorizer,
};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use team_agents::inbound::brain_mailbox::brain_mailbox_router;
use tower::ServiceExt;

use super::*;

const MEMBER: &str = "macro|brain-member@example.com";
const AGENT_PATH: &str = "/auth/team_agents/macro%7Cbrain-teammate%40example.com/email";

#[test]
fn only_the_local_fixture_database_qualifies_for_mailbox_routes() {
    let local = PgConnectOptions::new().host("127.0.0.1").database(DATABASE);
    for environment in [Environment::Develop, Environment::Production] {
        assert!(!enabled(environment, &local));
    }
    assert!(!enabled(
        Environment::Local,
        &local.clone().database("macrodb")
    ));
    assert!(!enabled(
        Environment::Local,
        &local.clone().host("192.0.2.1")
    ));
    assert!(enabled(Environment::Local, &local));
}

fn token(viewer: &str, secret: &[u8]) -> String {
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3_600;
    let claims = MacroAccessToken {
        aud: String::new(),
        exp: expires_at,
        tid: "fixture-tenant".to_owned(),
        iss: String::new(),
        email: viewer.trim_start_matches("macro|").to_owned(),
        fusion_user_id: "fixture-fusion-user".to_owned(),
        macro_user_id: viewer.to_owned(),
        macro_organization_id: None,
        root_macro_id: None,
    };
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("fixture-session".to_owned());
    jsonwebtoken::encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap()
}

async fn get(router: &Router, endpoint: &str, token: &str) -> (StatusCode, Value) {
    get_with_header(
        router,
        endpoint,
        Some((header::AUTHORIZATION, format!("Bearer {token}"))),
    )
    .await
}

async fn get_with_header(
    router: &Router,
    endpoint: &str,
    credential: Option<(header::HeaderName, String)>,
) -> (StatusCode, Value) {
    let mut request = Request::get(format!("{AGENT_PATH}{endpoint}"));
    if let Some((name, value)) = credential {
        request = request.header(name, value);
    }
    let request = request.body(Body::empty()).unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "private, no-store"
    );
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 16 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

// This test mutates its disposable identity fixture to simulate revocation and
// replacement. It needs the seeded, named loopback test database.
#[tokio::test]
#[ignore = "needs the dedicated Brain Email PostgreSQL fixture"]
async fn signed_brain_email_reads_use_current_pg_authority_and_private_cursors() {
    let options = PgConnectOptions::from_str(&std::env::var("TEST_DATABASE_URL").unwrap()).unwrap();
    assert!(enabled(Environment::Local, &options));
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect_with(options)
        .await
        .unwrap();
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let auth = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
        InternalAuthConfig {
            api_key: "fixture-internal".to_owned(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));
    let router = Router::new().nest(
        "/auth/team_agents",
        brain_mailbox_router(configure(Environment::Local, &pool, access, auth).unwrap()),
    );
    let owner = token(OWNER, b"");
    let admin = token(ADMIN, b"");
    let address = format!("/address?teamId={TEAM}");
    let page = format!("/inbox?teamId={TEAM}&limit=1&subject=status&from=sender");
    let thread = format!("/threads/{THREAD}?teamId={TEAM}");
    let denied = (
        StatusCode::NOT_FOUND,
        json!({"message": "mailbox unavailable"}),
    );

    let provisioned = (
        StatusCode::OK,
        json!({"state": "provisioned", "address": "fixture-inbox@example.org"}),
    );
    assert_eq!(get(&router, &address, &owner).await, provisioned);
    assert_eq!(
        get_with_header(
            &router,
            &address,
            Some((
                header::COOKIE,
                format!(
                    "{}={owner}",
                    macro_auth::credential::access_token_cookie_name()
                ),
            )),
        )
        .await,
        provisioned
    );
    assert_eq!(
        get_with_header(&router, &address, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    let program = Request::get(format!("{AGENT_PATH}{address}"))
        .header(header::AUTHORIZATION, format!("Bearer {owner}"))
        .header(macro_authorization::CODE_EXECUTION_HEADER, "1")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router.clone().oneshot(program).await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(get(&router, &address, &token(MEMBER, b"")).await, denied);
    assert_eq!(get(&router, &address, &token(AGENT, b"")).await, denied);
    assert_eq!(
        get(&router, &address, &token(OWNER, b"incorrect")).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get_with_header(
            &router,
            &address,
            Some((
                header::HeaderName::from_static(macro_auth::credential::USER_API_KEY_HEADER),
                "fixture-agent-key".to_owned(),
            )),
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );

    // Open the thread before listing. The direct read owns its authorization.
    let (status, opened) = get(&router, &thread, &admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(opened["messages"].as_array().unwrap().len(), 2);
    assert_eq!(
        opened["messages"][0]["summary"]["subject"],
        "Fixture status"
    );
    assert_eq!(
        opened["messages"][1]["text"],
        "The local review fixture is ready."
    );
    assert_eq!(get(&router, &thread, &token(MEMBER, b"")).await, denied);
    assert_eq!(
        get(
            &router,
            &format!("/threads/{}?teamId={TEAM}", Uuid::nil()),
            &owner
        )
        .await,
        denied
    );

    let (status, filtered_out) = get(
        &router,
        &format!("/inbox?teamId={TEAM}&subject=status&from=other"),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(filtered_out, json!({"items": [], "nextCursor": null}));

    let (status, first) = get(&router, &page, &owner).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["items"][0]["subject"], "Fixture status update");
    assert!(first["items"][0].get("text").is_none());
    let cursor = first["nextCursor"].as_str().unwrap();
    let next = format!("{page}&cursor={cursor}");
    assert_eq!(get(&router, &next, &admin).await, denied);
    assert_eq!(
        get(
            &router,
            &format!("/inbox?teamId={}&cursor={cursor}", Uuid::nil()),
            &owner
        )
        .await,
        denied
    );
    assert_eq!(
        get(
            &router,
            &format!("/inbox?teamId={TEAM}&cursor={cursor}"),
            &owner
        )
        .await,
        denied
    );
    let (status, second) = get(&router, &next, &owner).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second["items"][0]["subject"], "Fixture status");
    assert!(second["nextCursor"].is_null());

    async fn set_agent(pool: &PgPool, is_agent: bool) {
        sqlx::query!(
            r#"UPDATE "User" SET "isAgent" = $1 WHERE id = $2"#,
            is_agent,
            ADMIN
        )
        .execute(pool)
        .await
        .unwrap();
    }
    set_agent(&pool, true).await;
    let after_revocation = get(&router, &thread, &admin).await;
    set_agent(&pool, false).await;
    assert_eq!(after_revocation, denied);

    let replacement = uuid::uuid!("63e74f20-5f3a-4d94-98c9-bb35cb900099");
    async fn replace(pool: &PgPool, old: Uuid, new: Uuid) {
        let mut tx = pool.begin().await.unwrap();
        sqlx::query!("UPDATE agent_mailboxes SET id = $1 WHERE id = $2", new, old)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query!(
            "UPDATE team_agent_inboxes SET mailbox_id = $1 WHERE agent_user_id = $2 AND mailbox_id = $3",
            new,
            AGENT,
            old
        )
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }
    replace(&pool, MAILBOX, replacement).await;
    let stale = get(&router, &next, &owner).await;
    let identity = get(&router, &address, &owner).await;
    let content = get(&router, &thread, &owner).await;
    replace(&pool, replacement, MAILBOX).await;

    assert_eq!(stale, denied);
    assert_eq!(content, denied);
    assert_eq!(
        identity,
        (
            StatusCode::OK,
            json!({"state": "provisioned", "address": "fixture-inbox@example.org"})
        )
    );
}
