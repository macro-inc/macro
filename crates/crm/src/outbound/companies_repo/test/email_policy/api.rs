//! Real authenticated policy routes, current membership and isolated storage.
mod authority;
mod limits;
mod preview;
use super::*;
use crate::{
    domain::{email_policy_api::*, service::CrmServiceImpl},
    inbound::axum_router::{CrmRouterState, email_policy},
    outbound::no_op_resolver::NoOpCompanyMetadataResolver,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::{get, post},
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{
    CredentialOrigin, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, MacroAuthorizationState, NoBotAuthorizer,
    NoUserApiKeyAuthorizer, ValidatedCredential, ValidatedIdentity,
};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tower::ServiceExt;

const AGENT: Uuid = Uuid::from_u128(42);
#[derive(Debug)]
struct Rollout(Arc<AtomicBool>);
#[async_trait::async_trait]
impl SelectiveEmailGate for Rollout {
    async fn enabled_for(&self, _: macro_user_id::user_id::MacroUserIdStr<'_>) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}
#[derive(Clone)]
struct Credential;
impl JwtValidator for Credential {
    fn validate_credential(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, rootcause::Report<MacroAuthorizationError>> {
        if !matches!(token, "owner" | "agent") {
            return Err(rootcause::Report::new(
                MacroAuthorizationError::InvalidCredentials,
            ));
        }
        Ok(ValidatedCredential {
            origin: if token == "agent" {
                CredentialOrigin::MacroApiJwt
            } else {
                CredentialOrigin::Session
            },
            identity: ValidatedIdentity {
                user_id: OWNER.into(),
                fusion_user_id: "fixture".into(),
                organization_id: None,
                permissions: None,
                agent_id: (token == "agent").then_some(bot_id::BotId::new_from_uuid(AGENT)),
                agent_via: None,
                routine_id: None,
            },
        })
    }
}
fn app(pool: &PgPool, rollout: Arc<AtomicBool>) -> Router {
    let state = CrmRouterState {
        service: Arc::new(
            CrmServiceImpl::new(
                CompaniesRepositoryImpl::new(pool.clone()),
                NoOpCompanyMetadataResolver,
            )
            .with_selective_email_gate(Arc::new(Rollout(rollout))),
        ),
        stage_service: Arc::new(()),
        entity_access_service: Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
        authorization_state: MacroAuthorizationState::new(Arc::new(
            MacroAuthorizationServiceImpl::new(
                Credential,
                InternalAuthConfig {
                    api_key: "fixture-only".into(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                NoUserApiKeyAuthorizer,
            ),
        )),
    };
    Router::new()
        .route(
            "/policy",
            get(email_policy::get_handler::<_, (), _, _>)
                .put(email_policy::update_handler::<_, (), _, _>),
        )
        .route(
            "/validate",
            post(email_policy::validate_handler::<_, (), _, _>),
        )
        .route(
            "/history",
            get(email_policy::history_handler::<_, (), _, _>),
        )
        .route(
            "/revisions/{revision}",
            get(email_policy::revision_handler::<_, (), _, _>),
        )
        .route(
            "/preview",
            get(email_policy::preview_handler::<_, (), _, _>)
                .post(email_policy::start_preview_handler::<_, (), _, _>),
        )
        .with_state(state)
}
async fn request(
    app: &Router,
    credential: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .uri(path)
        .header("authorization", format!("Bearer {credential}"));
    // Unverified hints must never turn a person into an audited agent.
    builder = builder.header("x-agent-id", Uuid::from_u128(99).to_string());
    let body = match body {
        Some(value) => {
            builder = builder
                .method(if matches!(path, "/validate" | "/preview") {
                    "POST"
                } else {
                    "PUT"
                })
                .header("content-type", "application/json");
            Body::from(value.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).expect("fixture request"))
        .await
        .expect("router response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 256 * 1024)
        .await
        .expect("bounded response");
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn metadata(pool: &PgPool, team: Uuid) -> anyhow::Result<Value> {
    Ok(sqlx::query_scalar!(
        r#"SELECT jsonb_build_object(
        'consent',(SELECT to_jsonb(c) FROM crm_email_consent c WHERE team_id=$1),
        'outbox',(SELECT to_jsonb(o) FROM crm_email_backfill_outbox o WHERE team_id=$1),
        'work',(SELECT to_jsonb(w) FROM crm_email_policy_work w WHERE team_id=$1),
        'audit',(SELECT count(*) FROM crm_email_policy_audit WHERE team_id=$1),
        'rules',(SELECT count(*) FROM crm_email_rule_revisions WHERE team_id=$1)
    ) AS "state!""#,
        team
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inspection_is_side_effect_free_with_both_flags_and_absent_or_legacy_consent(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, _) = setup(&pool).await?;
    let rollout = Arc::new(AtomicBool::new(false));
    let app = app(&pool, rollout.clone());
    for legacy in [false, true] {
        if legacy {
            consent_to_mailbox(&pool, team, link).await?;
        }
        let before = metadata(&pool, team).await?;
        for enabled in [false, true, false] {
            rollout.store(enabled, Ordering::SeqCst);
            for credential in ["owner", "agent"] {
                let (status, view) = request(&app, credential, "/policy", None).await;
                assert_eq!(status, StatusCode::OK, "{view}");
                assert_eq!(view["enabled"], legacy);
                assert_eq!(view["token"].is_null(), !enabled);
                if enabled {
                    assert_eq!(view["token"]["kind"], "legacy");
                }
                assert_eq!(metadata(&pool, team).await?, before);
            }
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn first_write_rejects_stale_legacy_state_and_transfers_inflight_history_once(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let rollout = Arc::new(AtomicBool::new(true));
    let app = app(&pool, rollout);
    let stale = request(&app, "owner", "/policy", None).await.1["token"].clone();
    consent_to_mailbox(&pool, team, link).await?;
    let failed =
        json!({"if_policy":stale,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(failed)).await.0,
        StatusCode::CONFLICT
    );
    assert!(
        sqlx::query_scalar!(
            "SELECT consent_incarnation FROM crm_email_consent WHERE team_id=$1 AND user_id=$2",
            team,
            OWNER
        )
        .fetch_one(&pool)
        .await?
        .is_none()
    );
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    // The old outbox has already published; its absent row cannot prove that
    // historical work completed. First write must restart generation-bound work.
    sqlx::query!(
        "DELETE FROM crm_email_backfill_outbox WHERE team_id=$1",
        team
    )
    .execute(&pool)
    .await?;
    let command =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    let (status, outcome) = request(&app, "agent", "/policy", Some(command.clone())).await;
    assert_eq!(status, StatusCode::OK, "{outcome}");
    let after = metadata(&pool, team).await?;
    assert!(after["consent"]["enabled"].as_bool().expect("bool"));
    assert!(!after["consent"]["consent_incarnation"].is_null());
    assert_eq!(
        after["work"]["consent_incarnation"],
        after["consent"]["consent_incarnation"]
    );
    assert_eq!(after["outbox"]["work_id"], after["work"]["work_id"]);
    assert_eq!(
        after["work"]["policy_version"],
        after["consent"]["policy_version"]
    );
    let (status, replay) = request(&app, "agent", "/policy", Some(command.clone())).await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["audit_event_id"], outcome["audit_event_id"]);
    assert_eq!(metadata(&pool, team).await?, after);
    let mut different = command;
    different["change"] = json!({"action":"withdraw"});
    assert_eq!(
        request(&app, "agent", "/policy", Some(different)).await.0,
        StatusCode::CONFLICT
    );
    let history = request(&app, "owner", "/history", None).await.1;
    assert_eq!(history["events"][0]["entry"]["actor_kind"], "agent");
    assert_eq!(history["events"][0]["entry"]["agent_id"], AGENT.to_string());
    assert!(repo.inspect_email_policy(team, OWNER).await?.enabled);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn direct_agent_activation_validation_flag_refusal_and_private_withdrawal(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    // Private policy controls do not depend on CRM viewing access.
    sqlx::query!(
        "UPDATE team_user SET crm_access=FALSE WHERE team_id=$1 AND user_id=$2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    let rollout = Arc::new(AtomicBool::new(true));
    let app = app(&pool, rollout.clone());
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let command = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":{"schema_version":1,"include":[{"kind":"address","address":"Person+tag@Example.com"},{"kind":"address","address":" person+tag@example.com "}]}}});
    let (status, outcome) = request(&app, "agent", "/policy", Some(command.clone())).await;
    assert_eq!(status, StatusCode::OK, "{outcome}");
    let view = request(&app, "owner", "/policy", None).await.1;
    assert_eq!(
        view["rules"]["include"],
        json!([{"kind":"address","address":"person+tag@example.com"}])
    );
    assert_eq!(view["enabled"], true);
    assert_eq!(view["mode"], "selected");
    let row = sqlx::query!(
        "SELECT enabled,selected_enabled FROM crm_email_consent WHERE team_id=$1 AND user_id=$2",
        team,
        OWNER
    )
    .fetch_one(&pool)
    .await?;
    assert!(!row.enabled && row.selected_enabled);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_rule_addresses WHERE team_id=$1",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(1)
    );
    let before = metadata(&pool, team).await?;
    rollout.store(false, Ordering::SeqCst);
    let retry = json!({"if_policy":view["token"],"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "owner", "/policy", Some(retry)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(metadata(&pool, team).await?, before);
    let withdraw = json!({"if_policy":view["token"],"request_id":Uuid::now_v7(),"change":{"action":"withdraw"}});
    let (status, withdrawn) = request(&app, "owner", "/policy", Some(withdraw)).await;
    assert_eq!(status, StatusCode::OK, "{withdrawn}");
    assert_eq!(withdrawn["enabled"], false);
    assert_eq!(withdrawn["revision"], view["revision"]);
    assert!(metadata(&pool, team).await?["work"].is_null());
    assert!(metadata(&pool, team).await?["outbox"].is_null());
    let history = request(&app, "owner", "/history", None).await.1;
    assert_eq!(history["events"][0]["entry"]["actor_kind"], "member");
    assert!(history["events"][0]["entry"]["agent_id"].is_null());
    let (status, replayed) = request(&app, "agent", "/policy", Some(command)).await;
    assert_eq!(status, StatusCode::OK, "{replayed}");
    assert_eq!(replayed["replayed"], true);
    assert!(!repo.inspect_email_policy(team, OWNER).await?.enabled);
    assert_eq!(
        repo.email_consent(team, OWNER).await?.mailbox_link_id,
        Some(link)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn invalid_rules_and_scoped_credentials_never_initialize_or_share(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _, _) = setup(&pool).await?;
    let rollout = Arc::new(AtomicBool::new(true));
    let app = app(&pool, rollout.clone());
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let before = metadata(&pool, team).await?;
    for rule in [
        json!({"kind":"thread","thread_id":Uuid::now_v7()}),
        json!({"kind":"contact","contact_id":Uuid::now_v7()}),
        json!({"kind":"domain","domain":"co.uk"}),
        json!({"kind":"domain","domain":format!("{}.{}","gmail","com")}),
    ] {
        let command = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":{"schema_version":1,"include":[rule]}}});
        let (status, result) = request(&app, "agent", "/policy", Some(command)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{result}");
        assert_eq!(metadata(&pool, team).await?, before);
    }
    let command = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":{"schema_version":1,"include":[]}}});
    for scope in [
        agent_correlation::scope::SessionScope::NoSend,
        agent_correlation::scope::SessionScope::DryRun,
        agent_correlation::scope::SessionScope::Generation,
    ] {
        let attribution = agent_correlation::context::Attribution {
            scope: Some(scope),
            ..Default::default()
        };
        let (status, result) = agent_correlation::context::scope_attribution(
            attribution,
            request(&app, "agent", "/policy", Some(command.clone())),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{scope:?}: {result}");
        assert_eq!(metadata(&pool, team).await?, before);
    }
    rollout.store(false, Ordering::SeqCst);
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(metadata(&pool, team).await?, before);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn first_activation_between_empty_reference_probe_and_delete_is_reconciled(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::{
        companies_repo::CompaniesRepository, email_policy_work::EmailPolicyWorkService,
    };
    let (team, link, repo) = setup(&pool).await?;
    let contact = Uuid::now_v7();
    sqlx::query!("INSERT INTO crm_contacts(id,team_id,email,first_interaction,last_interaction) VALUES($1,$2,'person@example.com',now(),now())",contact,team).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO crm_contact_sources(contact_id,link_id) VALUES($1,$2)",
        contact,
        link
    )
    .execute(&pool)
    .await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let gate = Arc::new(super::super::ContactWriteGate::default());
    let mut deleting = repo.clone();
    deleting.before_unreferenced_teardown = Some(gate.clone());
    let teardown =
        tokio::spawn(async move { deleting.depopulate_link_in_team(&team, &link).await });
    gate.entered.notified().await;
    let command = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":{"schema_version":1,"include":[{"kind":"contact","contact_id":contact}]}}});
    let result = request(&app, "agent", "/policy", Some(command)).await;
    gate.resume.notify_one();
    teardown.await??;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_contacts WHERE id=$1", contact)
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    let event = sqlx::query!(
        "SELECT source_kind,source_id FROM crm_email_policy_source_events WHERE team_id=$1",
        team
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(event.source_kind, "team");
    assert_eq!(event.source_id, team);
    let before = metadata(&pool, team).await?;
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    assert!(service.reconcile_source_page().await?);
    let after = metadata(&pool, team).await?;
    assert_ne!(after["work"]["work_id"], before["work"]["work_id"]);
    assert_eq!(after["audit"], 2);
    assert!(service.reconcile_source_page().await?);
    assert!(!service.reconcile_source_page().await?);
    assert_eq!(
        metadata(&pool, team).await?,
        after,
        "reconciliation must not reset history on replay"
    );

    // A subsequent activation must revalidate the now-deleted live target.
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let stale_target = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":{"schema_version":1,"include":[{"kind":"contact","contact_id":contact}]}}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(stale_target))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(metadata(&pool, team).await?, after);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_recreated_consent_and_membership_do_not_accept_an_old_legacy_observation(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, _repo) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    sqlx::query!(
        "DELETE FROM crm_email_consent WHERE team_id=$1 AND user_id=$2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    consent_to_mailbox(&pool, team, link).await?;
    let command =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::CONFLICT
    );
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let command =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    let (status, initialized) = request(&app, "agent", "/policy", Some(command)).await;
    assert_eq!(status, StatusCode::OK, "{initialized}");
    let prior_incarnation = initialized["token"]["consent_incarnation"].clone();
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id=$2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert!(
        metadata(&pool, team).await?["consent"].is_null(),
        "membership leave must cascade consent"
    );
    sqlx::query!(
        "INSERT INTO team_user(team_id,user_id,team_role) VALUES($1,$2,'member')",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    let command = json!({"if_policy":initialized["token"],"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::CONFLICT
    );
    assert!(metadata(&pool, team).await?["consent"].is_null());
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let command =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    let (status, rejoined) = request(&app, "agent", "/policy", Some(command)).await;
    assert_eq!(status, StatusCode::OK, "{rejoined}");
    assert_ne!(rejoined["token"]["consent_incarnation"], prior_incarnation);
    Ok(())
}
