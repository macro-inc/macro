//! Revocation through the real HTTP, search and aggregate-list service paths.
use super::helpers::{insert_company, seed_team};
use crate::{
    domain::{
        association::CrmAssociation,
        auth::CrmTeamReceipt,
        companies_repo::CrmCompanyListSort,
        contact_listing::CrmContactListQuery,
        model::CrmError,
        search_service::{CrmSearchService, CrmSearchServiceImpl},
        service::{CrmService, CrmServiceImpl},
    },
    inbound::axum_router::{self, CrmRouterState},
    outbound::{
        companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
        search_repo::CrmSearchRepositoryImpl,
    },
};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::get,
};
use entity_access::{
    domain::{
        models::MemberTeamRole, ports::EntityAccessService, service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use filter_ast::Expr;
use item_filters::ast::crm_contact::CrmContactLiteral;
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";
const MEMBER: &str = "macro|member@example.com";
#[derive(Clone)]
struct Credentials;
impl JwtValidator for Credentials {
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
async fn status(app: &Router, actor: &str, path: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header("authorization", format!("Bearer {actor}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn member_access_revocation_reaches_http_search_and_soup(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    let member_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        member_id,
        MEMBER
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        MEMBER,
        member_id
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')", team, OWNER, MEMBER).execute(&pool).await?;
    let company = insert_company(&pool, team, true, &["company.example.com"]).await?;
    let contact = Uuid::now_v7();
    sqlx::query!("INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction) VALUES ($1, $2, 'contact@company.example.com', now(), now())", contact, company).execute(&pool).await?;
    let service = Arc::new(CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    ));
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let viewer = MacroUserIdStr::parse_from_str(MEMBER)?;
    let receipt = CrmTeamReceipt::from_team_receipt(
        access
            .generate_entity_access_receipt::<MemberTeamRole>(
                &viewer,
                None,
                &team.to_string(),
                entity_access::domain::models::EntityType::Team,
            )
            .await?,
    )?;
    let search = CrmSearchServiceImpl::new(CrmSearchRepositoryImpl::new(pool.clone()));
    let state = CrmRouterState {
        service: service.clone(),
        stage_service: Arc::new(()),
        entity_access_service: access.clone(),
        authorization_state: MacroAuthorizationState::new(Arc::new(
            MacroAuthorizationServiceImpl::new(
                Credentials,
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
            "/crm/member-access",
            get(axum_router::member_access::handler::<_, (), _, _>),
        )
        .route(
            "/crm/companies/{company_id}",
            get(axum_router::get_company::handler::<_, (), _, _>),
        )
        .route(
            "/crm/contacts/{contact_id}",
            get(axum_router::get_contact::handler::<_, (), _, _>),
        )
        .route(
            "/crm/contacts",
            get(axum_router::search_contacts::handler::<_, (), _, _>),
        )
        .route(
            "/crm/settings",
            get(axum_router::team_settings::get_handler::<_, (), _, _>),
        )
        .route(
            "/crm/email-privacy",
            get(axum_router::email_privacy::get_handler::<_, (), _, _>),
        )
        .with_state(state);
    let tools = crate::inbound::toolset::CrmToolContext {
        service: service.clone(),
        entity_access_service: access,
        properties: Arc::new(properties::PropertiesServiceImpl::new(
            properties::PropertiesPgRepo::new(pool.clone()),
            None::<NoPermissions>,
            None::<NoNotifications>,
        )),
    };
    for enabled in [true, false, true] {
        sqlx::query!(
            "UPDATE team_user SET crm_access = $3 WHERE team_id = $1 AND user_id = $2",
            team,
            MEMBER,
            enabled
        )
        .execute(&pool)
        .await?;
        let authority = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/crm/member-access")
                    .header("authorization", "Bearer member")
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(authority.status(), StatusCode::OK);
        let authority: serde_json::Value =
            serde_json::from_slice(&axum::body::to_bytes(authority.into_body(), 4096).await?)?;
        assert_eq!(authority["team_id"], team.to_string());
        assert_eq!(authority["allowed"], enabled);
        for path in [
            format!("/crm/companies/{company}"),
            format!("/crm/contacts/{contact}"),
            "/crm/contacts".into(),
            "/crm/settings".into(),
        ] {
            let response = status(&app, "member", &path).await;
            if enabled {
                assert_eq!(response, StatusCode::OK, "{path}");
            } else {
                assert!(
                    matches!(
                        response,
                        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
                    ),
                    "{path}: {response}"
                );
            }
            assert_eq!(
                status(&app, "owner", &path).await,
                StatusCode::OK,
                "owner {path}"
            );
        }
        assert_eq!(
            status(&app, "member", "/crm/email-privacy").await,
            StatusCode::OK
        );
        assert_eq!(
            search
                .search_company_names(&receipt, "company", &[], None, 50, None)
                .await?
                .is_empty(),
            !enabled
        );
        assert_eq!(
            search
                .enrich_companies(&receipt, &[company])
                .await?
                .is_empty(),
            !enabled
        );
        assert_eq!(
            service
                .list_companies_for_soup(
                    &receipt,
                    MEMBER,
                    &[],
                    None,
                    CrmCompanyListSort::UpdatedAt,
                    None,
                    50
                )
                .await?
                .is_empty(),
            !enabled
        );
        let contacts = service
            .list_contacts_for_soup(
                MEMBER,
                Some(&receipt),
                CrmContactListQuery {
                    filter: Expr::val(CrmContactLiteral::Include),
                    sort: CrmCompanyListSort::UpdatedAt,
                    cursor: None,
                    ascending: false,
                    limit: 50,
                },
            )
            .await?;
        assert_eq!(contacts.is_empty(), !enabled);
        let activity = service
            .resolve_association(MEMBER, Some(&receipt), CrmAssociation::Activity)
            .await?;
        assert_eq!(activity.contact_ids.is_empty(), !enabled);
        assert_eq!(
            service
                .resolve_association(MEMBER, Some(&receipt), CrmAssociation::Contact(contact))
                .await
                .is_ok(),
            enabled
        );
        assert_eq!(
            service
                .crm_scope_precheck(&receipt, &["company.example.com".into()], &[])
                .await
                .is_ok(),
            enabled
        );
        use ai_toolset::AsyncTool;
        let created = crate::inbound::toolset::CreateCompany {
            name: "Tool-created company".into(),
            domain: None,
        }
        .call(
            ai_toolset::ServiceContext(tools.clone()),
            ai_toolset::RequestContext::new(viewer.clone().into_owned()),
        )
        .await;
        assert_eq!(created.is_ok(), enabled);
        if !enabled {
            assert!(matches!(
                service.create_company(&receipt, "Denied", None).await,
                Err(CrmError::AccessDenied)
            ));
        }
    }
    Ok(())
}

struct NoPermissions;
impl properties::PermissionService for NoPermissions {
    type Err = anyhow::Error;
    async fn mint_view_receipt<'a>(
        &self,
        _: Option<&'a MacroUserIdStr<'a>>,
        _: &str,
        _: entity_access::domain::models::EntityType,
    ) -> Result<properties::domain::model::ViewReceipt, Self::Err> {
        unreachable!("creation does not read properties")
    }
    async fn mint_edit_receipt<'a>(
        &self,
        _: &MacroUserIdStr<'a>,
        _: &str,
        _: entity_access::domain::models::EntityType,
    ) -> Result<properties::domain::model::EditReceipt, Self::Err> {
        unreachable!("creation does not edit properties")
    }
    async fn grant_permissions_to_task<'a>(
        &self,
        _: &[MacroUserIdStr<'a>],
        _: &str,
    ) -> Result<(), Self::Err> {
        unreachable!("creation does not grant task access")
    }
}
struct NoNotifications;
impl properties::NotificationService for NoNotifications {
    type Err = anyhow::Error;
    async fn send_task_assigned<'a>(
        &self,
        _: properties::domain::model::TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        unreachable!("creation does not assign tasks")
    }
}
