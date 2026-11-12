//! Real HTTP extraction, domain policy and migrated persistence in an owned fixture.
use super::*;
use crate::{
    domain::service::CrmServiceImpl,
    inbound::axum_router::{CrmRouterState, email_privacy},
    outbound::no_op_resolver::NoOpCompanyMetadataResolver,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access_outbound::PgAccessRepository;
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use serde_json::{Value, json};
use std::sync::Arc;
use tower::ServiceExt;

const MEMBER: &str = "macro|member@example.com";
#[derive(Clone)]
struct FixtureCredential;
impl JwtValidator for FixtureCredential {
    fn validate_credential(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, rootcause::Report<MacroAuthorizationError>> {
        let user = match token {
            "owner" => OWNER,
            "member" => MEMBER,
            _ => {
                return Err(rootcause::Report::new(
                    MacroAuthorizationError::InvalidCredentials,
                ));
            }
        };
        Ok(ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: user.into(),
                fusion_user_id: "fixture".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

async fn request(app: &Router, user: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .uri("/crm/email-privacy")
        .header("authorization", format!("Bearer {user}"));
    let payload = if let Some(body) = body {
        builder = builder
            .method("PUT")
            .header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = app
        .clone()
        .oneshot(builder.body(payload).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn privacy_http_preserves_records_and_enforces_mailbox_and_role_boundaries(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    let user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        user,
        MEMBER
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        MEMBER,
        user
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        team,
        MEMBER
    )
    .execute(&pool)
    .await?;
    let company = insert_company(&pool, team, true, &["acme.example.com"]).await?;
    insert_contact(&pool, company, "pat@acme.example.com").await?;
    let thread = insert_interaction(&pool, link, "pat@acme.example.com", Utc::now(), true).await?;
    let state = CrmRouterState {
        service: Arc::new(CrmServiceImpl::new(
            repo.clone(),
            NoOpCompanyMetadataResolver,
        )),
        stage_service: Arc::new(()),
        entity_access_service: Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
        authorization_state: MacroAuthorizationState::new(Arc::new(
            MacroAuthorizationServiceImpl::new(
                FixtureCredential,
                InternalAuthConfig {
                    api_key: "fixture-only".into(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                NoUserApiKeyAuthorizer,
            ),
        )),
    };
    let app = Router::new()
        .route(
            "/crm/email-privacy",
            get(email_privacy::get_handler::<_, (), _, _>)
                .put(email_privacy::update_handler::<_, (), _, _>),
        )
        .with_state(state);
    assert_eq!(
        request(&app, "invalid", None).await.0,
        StatusCode::UNAUTHORIZED
    );
    let (status, initial) = request(&app, "owner", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["mailbox_link_id"], link.to_string());
    assert_eq!(initial["enabled"], false);
    assert_eq!(initial["can_remove_team_domains"], true);
    assert_eq!(
        request(&app, "member", None).await.1["can_remove_team_domains"],
        false
    );
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"set_consent","enabled":true,"link_id":Uuid::now_v7()}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert!(!allowed(&pool, team, thread).await?);
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"set_consent","enabled":true,"link_id":link}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(allowed(&pool, team, thread).await?);
    assert_eq!(
        request(
            &app,
            "member",
            Some(json!({"action":"add_domain","scope":"team","domain":"acme.example.com"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(!allowed(&pool, team, thread).await?);
    assert_eq!(
        request(
            &app,
            "member",
            Some(json!({"action":"remove_domain","scope":"team","domain":"acme.example.com"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert!(!allowed(&pool, team, thread).await?);
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"remove_domain","scope":"team","domain":"acme.example.com"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(allowed(&pool, team, thread).await?);
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"add_domain","scope":"personal","domain":"acme.example.com"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "member", None).await.1["personal_domains"],
        json!([])
    );
    assert!(!allowed(&pool, team, thread).await?);
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"remove_domain","scope":"personal","domain":"acme.example.com"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(
        allowed(&pool, team, thread).await?,
        "personal exclusion removal restores eligibility before withdrawal"
    );
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"set_consent","enabled":false,"link_id":link}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(!allowed(&pool, team, thread).await?);
    assert_eq!(request(&app, "owner", None).await.1["enabled"], false);
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert!(
        fetch_company_for_domain(&pool, team, "acme.example.com")
            .await?
            .is_some()
    );
    Ok(())
}
