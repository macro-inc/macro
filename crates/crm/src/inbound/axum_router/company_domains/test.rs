use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode, header},
};
use chrono::Utc;
use entity_access::domain::models::AccessLevel;
use macro_authorization::{
    InternalAuthConfig, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::{add_handler, remove_handler};
use crate::{
    domain::{companies_repo::CompaniesRepository, service::CrmServiceImpl},
    inbound::{
        axum_extractors::test::{
            FakeEntityAccessService, FakeJwtValidator, INTERNAL_KEY, TEAM_ID, USER_ID, VALID_TOKEN,
            uuid,
        },
        axum_router::CrmRouterState,
    },
    outbound::{
        companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    },
};

async fn seed_team(pool: &sqlx::PgPool, team: Uuid) -> anyhow::Result<()> {
    let user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        user,
        USER_ID,
        format!("stripe_{user}")
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO \"User\" (id, email, macro_user_id) VALUES ($1, $1, $2)",
        USER_ID,
        user
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Test team', $2)",
        team,
        USER_ID
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn router(repo: CompaniesRepositoryImpl, level: AccessLevel) -> Router {
    let authorization = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: INTERNAL_KEY.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        macro_authorization::NoUserApiKeyAuthorizer,
    );
    Router::new()
        .route(
            "/companies/{company_id}/domains",
            axum::routing::put(add_handler).delete(remove_handler),
        )
        .with_state(CrmRouterState {
            service: Arc::new(CrmServiceImpl::new(repo, NoOpCompanyMetadataResolver)),
            stage_service: Arc::new(()),
            entity_access_service: Arc::new(FakeEntityAccessService::with_access_level(level)),
            authorization_state: MacroAuthorizationState::new(Arc::new(authorization)),
        })
}

/// Domains travel in the body, so request telemetry never records one.
fn request(method: Method, company: Uuid, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(format!("/companies/{company}/domains"))
        .header(header::AUTHORIZATION, format!("Bearer {VALID_TOKEN}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn send(router: &Router, request: Request<Body>) -> anyhow::Result<(StatusCode, Value)> {
    let response = router.clone().oneshot(request).await?;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await?;
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Ok((status, body))
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn company_domain_routes_need_edit_access_and_name_the_company_holding_a_domain(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let team = uuid(TEAM_ID);
    seed_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company = repo
        .create_company_for_team(&team, Some("example.com"), "Example", Utc::now())
        .await?
        .company
        .id;
    let other = repo
        .create_company_for_team(&team, Some("example.net"), "Other", Utc::now())
        .await?
        .company
        .id;
    let edit = router(repo.clone(), AccessLevel::Edit);

    let (status, _) = send(
        &router(repo.clone(), AccessLevel::View),
        request(Method::PUT, company, json!({ "domain": "example.org" })),
    )
    .await?;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    for _ in 0..2 {
        let (status, body) = send(
            &edit,
            request(Method::PUT, company, json!({ "domain": "Example.org" })),
        )
        .await?;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["name"], "Example");
        assert_eq!(
            body["domains"].as_array().map(|domains| domains
                .iter()
                .map(|d| d["domain"].clone())
                .collect::<Vec<_>>()),
            Some(vec![json!("example.com"), json!("example.org")])
        );
    }

    let (status, body) = send(
        &edit,
        request(Method::PUT, company, json!({ "domain": "example.net" })),
    )
    .await?;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["companyId"], json!(other));
    assert_eq!(body["companyName"], "Other");

    let (status, body) = send(
        &edit,
        request(Method::DELETE, company, json!({ "domain": "example.org" })),
    )
    .await?;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["domains"].as_array().map(Vec::len), Some(1));
    Ok(())
}
