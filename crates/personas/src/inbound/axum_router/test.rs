use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    NoBotAuthorizer, ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use rootcause::Report;
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::domain::service::PersonaServiceImpl;
use crate::outbound::pg_personas_repo::PgPersonasRepo;

const OWNER: &str = "macro|persona-owner@example.com";
const STRANGER: &str = "macro|persona-stranger@example.com";
const INVALID_BEARER_TOKEN: &str = "invalid";

#[derive(Clone)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        if jwt == INVALID_BEARER_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(ValidatedIdentity {
            user_id: jwt.to_string(),
            fusion_user_id: "fusion-user".to_string(),
            organization_id: None,
            permissions: None,
        })
    }
}

type TestAuthorizationService = MacroAuthorizationServiceImpl<FakeJwtValidator>;

fn authorization_state() -> MacroAuthorizationState<TestAuthorizationService> {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
    );
    MacroAuthorizationState::new(Arc::new(service))
}

fn router(pool: &PgPool) -> Router {
    personas_router(PersonasRouterState::new(
        PersonaServiceImpl::new(PgPersonasRepo::new(pool.clone())),
        authorization_state(),
    ))
}

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    let macro_user_id: Uuid = sqlx::query_scalar!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
        "#,
        Uuid::new_v4(),
        email,
        email,
        format!("stripe_{email}"),
    )
    .fetch_one(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn request(method: &str, uri: &str, bearer: Option<&str>, body: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(bearer) = bearer {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
    }
    match body {
        Some(body) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_owned()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn create_persona(pool: &PgPool, owner: &str, handle: &str) -> serde_json::Value {
    let body = format!(
        r#"{{"name":"Bug Fixer","handle":"{handle}","system_prompt":"Run the tests first."}}"#
    );
    let response = router(pool)
        .oneshot(request("POST", "/personas", Some(owner), Some(&body)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    json_body(response).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_then_list_and_get(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;

    let created = create_persona(&pool, OWNER, "bug-fixer").await;
    assert_eq!(created["handle"], "bug-fixer");
    assert_eq!(created["owner_user_id"], OWNER);
    let id = created["id"].as_str().unwrap().to_owned();

    let response = router(&pool)
        .oneshot(request("GET", "/personas", Some(OWNER), None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let listed = json_body(response).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);

    let response = router(&pool)
        .oneshot(request(
            "GET",
            &format!("/personas/{id}"),
            Some(OWNER),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requests_without_credentials_are_unauthorized(pool: PgPool) -> anyhow::Result<()> {
    let response = router(&pool)
        .oneshot(request("GET", "/personas", None, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_users_personas_are_not_found(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, STRANGER).await?;
    let created = create_persona(&pool, OWNER, "bug-fixer").await;
    let id = created["id"].as_str().unwrap().to_owned();

    for (method, body) in [
        ("GET", None),
        ("PATCH", Some(r#"{"name":"Mine Now"}"#)),
        ("DELETE", None),
    ] {
        let response = router(&pool)
            .oneshot(request(
                method,
                &format!("/personas/{id}"),
                Some(STRANGER),
                body,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method}");
    }

    // The stranger's list is empty rather than showing someone else's agent.
    let response = router(&pool)
        .oneshot(request("GET", "/personas", Some(STRANGER), None))
        .await
        .unwrap();
    let listed = json_body(response).await;
    assert!(listed.as_array().unwrap().is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_updates_and_null_clears(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let created = create_persona(&pool, OWNER, "bug-fixer").await;
    let id = created["id"].as_str().unwrap().to_owned();

    let response = router(&pool)
        .oneshot(request(
            "PATCH",
            &format!("/personas/{id}"),
            Some(OWNER),
            Some(r#"{"name":"Test Runner","system_prompt":null}"#),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let patched = json_body(response).await;
    assert_eq!(patched["name"], "Test Runner");
    assert_eq!(patched["handle"], "bug-fixer");
    assert!(patched["system_prompt"].is_null());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserved_and_duplicate_handles_conflict(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    create_persona(&pool, OWNER, "bug-fixer").await;

    for handle in ["macro", "bug-fixer"] {
        let body = format!(r#"{{"name":"Another","handle":"{handle}"}}"#);
        let response = router(&pool)
            .oneshot(request("POST", "/personas", Some(OWNER), Some(&body)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT, "{handle}");
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_returns_no_content_then_not_found(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let created = create_persona(&pool, OWNER, "bug-fixer").await;
    let id = created["id"].as_str().unwrap().to_owned();

    let response = router(&pool)
        .oneshot(request(
            "DELETE",
            &format!("/personas/{id}"),
            Some(OWNER),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = router(&pool)
        .oneshot(request(
            "GET",
            &format!("/personas/{id}"),
            Some(OWNER),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    Ok(())
}
