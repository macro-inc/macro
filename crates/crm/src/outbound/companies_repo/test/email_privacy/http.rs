//! Real HTTP extraction, domain policy and migrated persistence in an owned fixture.
mod mailbox_domains;
use super::*;
use crate::{
    domain::service::CrmServiceImpl,
    inbound::axum_router::{CrmRouterState, email_privacy, get_company, team_settings},
    outbound::no_op_resolver::NoOpCompanyMetadataResolver,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tower::ServiceExt;

const MEMBER: &str = "macro|member@example.com";
#[derive(Debug)]
struct ThreadExclusionRollout(Arc<AtomicBool>);

#[async_trait::async_trait]
impl crate::domain::email_privacy::ThreadExclusionGate for ThreadExclusionRollout {
    async fn enabled_for(&self, _: macro_user_id::user_id::MacroUserIdStr<'_>) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

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
                routine_id: None,
                user_id: user.into(),
                fusion_user_id: "fixture".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

async fn request(app: &Router, user: &str, body: Option<Value>) -> (StatusCode, Value) {
    request_path(app, user, "/crm/email-privacy", body).await
}

async fn request_path(
    app: &Router,
    user: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .uri(path)
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
    let rollout = Arc::new(AtomicBool::new(false));
    let state = CrmRouterState {
        service: Arc::new(
            CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver)
                .with_thread_exclusion_gate(Arc::new(ThreadExclusionRollout(rollout.clone()))),
        ),
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
        .route(
            "/crm/email-privacy/threads",
            get(email_privacy::excluded_threads_handler::<_, (), _, _>),
        )
        .route(
            "/crm/companies/{company_id}",
            get(get_company::handler::<_, (), _, _>),
        )
        .route(
            "/crm/settings",
            get(team_settings::get_handler::<_, (), _, _>),
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
    let consent_path = "/crm/email-privacy?consent_only=true";
    assert_eq!(
        request_path(&app, "invalid", consent_path, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request_path(&app, "owner", consent_path, None).await,
        (
            StatusCode::OK,
            json!({
                "enabled": false,
                "mailbox_email": initial["mailbox_email"],
                "mailbox_link_id": link,
            })
        )
    );
    assert_eq!(
        request_path(&app, "member", consent_path, None).await,
        (
            StatusCode::OK,
            json!({
                "enabled": false,
                "mailbox_email": null,
                "mailbox_link_id": null,
            })
        )
    );
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

    // Header consent must remain available without reading domain settings.
    let mut domain_lock = pool.begin().await?;
    sqlx::raw_sql(
        "LOCK TABLE crm_companies, crm_domains, crm_blocked_domains, crm_personal_email_blocklist IN ACCESS EXCLUSIVE MODE",
    )
    .execute(&mut *domain_lock)
    .await?;
    let (status, consent) = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        request_path(&app, "owner", consent_path, None),
    )
    .await
    .expect("consent projection must not wait for domain-list locks");
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        consent,
        json!({
            "enabled": true,
            "mailbox_email": initial["mailbox_email"],
            "mailbox_link_id": link,
        })
    );
    domain_lock.rollback().await?;

    for excluded in [true, false] {
        assert_eq!(
            request(
                &app,
                "owner",
                Some(
                    json!({"action":"set_thread_exclusion","thread_id":thread,"excluded":excluded})
                )
            )
            .await
            .0,
            StatusCode::FORBIDDEN,
        );
    }
    assert!(
        repo.excluded_email_threads(team, OWNER, None, None)
            .await?
            .threads
            .is_empty()
    );
    rollout.store(true, Ordering::SeqCst);
    for excluded in [true, false] {
        assert_eq!(
            request(
                &app,
                "member",
                Some(
                    json!({"action":"set_thread_exclusion","thread_id":thread,"excluded":excluded})
                )
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"set_thread_exclusion","thread_id":thread,"excluded":true}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(!allowed(&pool, team, thread).await?);
    for (actor, expected_count) in [("owner", 1), ("member", 0)] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/crm/email-privacy/threads")
                    .header("authorization", format!("Bearer {actor}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(body["threads"].as_array().unwrap().len(), expected_count);
        if actor == "owner" {
            assert_eq!(body["threads"][0]["thread_id"], thread.to_string());
        }
    }

    // The header lookup remains owner-only and has no continuation page.
    let lookup = format!("/crm/email-privacy/threads?thread_id={thread}");
    for (actor, expected_count) in [("owner", 1), ("member", 0)] {
        let (status, body) = request_path(&app, actor, &lookup, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["threads"].as_array().unwrap().len(), expected_count);
        assert!(body["next_cursor"].is_null());
        if actor == "owner" {
            assert_eq!(body["threads"][0]["thread_id"], thread.to_string());
        }
    }
    let absent = format!("/crm/email-privacy/threads?thread_id={}", Uuid::now_v7());
    let (status, body) = request_path(&app, "owner", &absent, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["threads"], json!([]));
    let mixed = format!("{lookup}&after={thread}");
    assert_eq!(
        request_path(&app, "owner", &mixed, None).await.0,
        StatusCode::BAD_REQUEST
    );

    assert_eq!(
        request(
            &app,
            "member",
            Some(json!({"action":"set_thread_exclusion","thread_id":thread,"excluded":false}))
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
            Some(json!({"action":"set_thread_exclusion","thread_id":thread,"excluded":false}))
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

    let member_link = insert_email_link(&pool, MEMBER, "member@example.com").await?;
    let member_thread =
        insert_interaction(&pool, member_link, "contact@example.org", Utc::now(), true).await?;
    let record_paths = [format!("/crm/companies/{company}"), "/crm/settings".into()];
    for path in &record_paths {
        assert_eq!(
            request_path(&app, "member", path, None).await.0,
            StatusCode::OK
        );
    }
    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE team_id = $1 AND user_id = $2",
        team,
        MEMBER
    )
    .execute(&pool)
    .await?;
    for path in &record_paths {
        assert!(matches!(
            request_path(&app, "member", path, None).await.0,
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
        ));
    }
    let (status, settings) = request(&app, "member", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(settings["mailbox_link_id"], member_link.to_string());
    assert_eq!(settings["enabled"], false);
    assert_eq!(
        request(
            &app,
            "member",
            Some(json!({"action":"set_consent","enabled":true,"link_id":member_link}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(allowed(&pool, team, member_thread).await?);
    for excluded in [true, false] {
        assert_eq!(
            request(
                &app,
                "member",
                Some(json!({"action":"set_thread_exclusion","thread_id":member_thread,"excluded":excluded}))
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(allowed(&pool, team, member_thread).await?, !excluded);
        let (status, exceptions) =
            request_path(&app, "member", "/crm/email-privacy/threads", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            exceptions["threads"].as_array().unwrap().len(),
            usize::from(excluded)
        );
        if excluded {
            assert_eq!(
                exceptions["threads"][0]["thread_id"],
                member_thread.to_string()
            );
        }
        assert_eq!(
            request(
                &app,
                "member",
                Some(
                    json!({"action":"set_thread_exclusion","thread_id":thread,"excluded":excluded})
                )
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        request(
            &app,
            "member",
            Some(json!({"action":"set_consent","enabled":false,"link_id":member_link}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(!allowed(&pool, team, member_thread).await?);
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert!(
        fetch_company_for_domain(&pool, team, "acme.example.com")
            .await?
            .is_some()
    );
    Ok(())
}
