use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{
    CredentialOrigin, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, MacroAuthorizationState, NoBotAuthorizer,
    NoUserApiKeyAuthorizer, ValidatedCredential, ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use properties::{PropertiesPgRepo, PropertiesServiceImpl};
use serde_json::{Value, json};
use sqlx::PgPool;
use system_properties::{StageOption, SystemPropertyKey};
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::domain::service::CrmServiceImpl;
use crate::outbound::{
    companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
};
use crate::test_support::{NoNotifications, NoPermissions};

const OWNER: &str = "macro|list-owner@macro.com";
const MEMBER: &str = "macro|list-member@macro.com";
/// The only member of a second team, with a company of its own.
const OUTSIDER: &str = "macro|list-outsider@macro.com";

/// Signs `owner` and `member` tokens in as those users.
#[derive(Clone)]
struct Tokens;
impl JwtValidator for Tokens {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, rootcause::Report<MacroAuthorizationError>> {
        let user_id = match jwt {
            "owner" => OWNER,
            "member" => MEMBER,
            "outsider" => OUTSIDER,
            _ => {
                return Err(rootcause::Report::new(
                    MacroAuthorizationError::InvalidCredentials,
                ));
            }
        };
        Ok(ValidatedCredential {
            origin: CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: user_id.into(),
                fusion_user_id: "test-fusion-user".into(),
                organization_id: None,
                permissions: None,
                routine_id: None,
            },
        })
    }
}

async fn seed(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
    let team = Uuid::now_v7();
    for user in [OWNER, MEMBER] {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2)",
        )
        .bind(id)
        .bind(user)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1,$1,$2)"#)
            .bind(user)
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Sales', $2)")
        .bind(team)
        .bind(OWNER)
        .execute(pool)
        .await
        .unwrap();
    for (user, role) in [(OWNER, "owner"), (MEMBER, "member")] {
        sqlx::query(
            "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, $3::team_role)",
        )
        .bind(team)
        .bind(user)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)")
        .bind(team)
        .execute(pool)
        .await
        .unwrap();
    let company = async |name: &str, domain: &str, days_ago: i32, hidden: bool| {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction)
             VALUES ($1, $2, $3, $4, now() - make_interval(days => $5), now() - make_interval(days => $5))",
        )
        .bind(id)
        .bind(team)
        .bind(name)
        .bind(hidden)
        .bind(days_ago)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(team)
            .bind(domain)
            .execute(pool)
            .await
            .unwrap();
        id
    };
    let globex = company("Globex", "globex.test", 0, false).await;
    let acme = company("Acme", "acme.test", 1, false).await;
    let initech = company("Initech", "initech.test", 2, true).await;
    let property = async |company: Uuid, definition: Uuid, values: Value| {
        sqlx::query(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
             VALUES ($1, $2, 'COMPANY', $3, $4)",
        )
        .bind(Uuid::now_v7())
        .bind(company.to_string())
        .bind(definition)
        .bind(values)
        .execute(pool)
        .await
        .unwrap();
    };
    property(
        acme,
        SystemPropertyKey::STAGE_UUID,
        json!({"type": "SelectOption", "value": [StageOption::CUSTOMER_UUID]}),
    )
    .await;
    property(
        acme,
        SystemPropertyKey::COMPANY_OWNER_UUID,
        json!({"type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": OWNER}]}),
    )
    .await;
    property(
        globex,
        SystemPropertyKey::STAGE_UUID,
        json!({"type": "SelectOption", "value": [StageOption::LEAD_UUID]}),
    )
    .await;
    (globex, acme, initech)
}

/// A second team whose only member is `OUTSIDER`, with one company and a
/// hidden one. Returns the team id.
async fn seed_other_team(pool: &PgPool) -> Uuid {
    let team = Uuid::now_v7();
    let macro_user = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2)",
    )
    .bind(macro_user)
    .bind(OUTSIDER)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1,$1,$2)"#)
        .bind(OUTSIDER)
        .bind(macro_user)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Rivals', $2)")
        .bind(team)
        .bind(OUTSIDER)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner'::team_role)",
    )
    .bind(team)
    .bind(OUTSIDER)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)")
        .bind(team)
        .execute(pool)
        .await
        .unwrap();
    for (name, domain, hidden) in [
        ("Rival Co", "rival.test", false),
        ("Rival Hidden", "rival-hidden.test", true),
    ] {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction)
             VALUES ($1, $2, $3, $4, now(), now())",
        )
        .bind(id)
        .bind(team)
        .bind(name)
        .bind(hidden)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(team)
            .bind(domain)
            .execute(pool)
            .await
            .unwrap();
    }
    team
}

fn app(pool: &PgPool) -> Router {
    let entity_access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let state = CompanyListState {
        tools: CrmToolContext {
            service: Arc::new(CrmServiceImpl::new(
                CompaniesRepositoryImpl::new(pool.clone()),
                NoOpCompanyMetadataResolver,
            )),
            entity_access_service: entity_access,
            properties: Arc::new(PropertiesServiceImpl::new(
                PropertiesPgRepo::new(pool.clone()),
                None::<NoPermissions>,
                None::<NoNotifications>,
            )),
        },
        authorization_state: MacroAuthorizationState::new(Arc::new(
            MacroAuthorizationServiceImpl::new(
                Tokens,
                InternalAuthConfig {
                    api_key: "test-only".into(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                NoUserApiKeyAuthorizer,
            ),
        )),
    };
    // Mounted the way document_storage_service mounts it.
    Router::new().nest("/crm", router(state))
}

async fn get(app: &Router, token: &str, uri: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

fn names(body: &Value) -> Vec<&str> {
    body["companies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|company| company["name"].as_str().unwrap())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lists_the_team_companies_with_the_tool_filters(pool: PgPool) {
    let (_, acme, initech) = seed(&pool).await;
    let app = app(&pool);

    let (status, all) = get(&app, "member", "/crm/companies").await;
    assert_eq!(status, StatusCode::OK, "{all}");
    assert_eq!(names(&all), ["Globex", "Acme"]);
    let listed_acme = &all["companies"][1];
    assert_eq!(listed_acme["id"], acme.to_string());
    assert_eq!(listed_acme["domains"], json!(["acme.test"]));
    assert_eq!(listed_acme["stage"]["label"], "Customer");
    assert_eq!(listed_acme["ownerUserId"], OWNER);
    assert_eq!(listed_acme["hidden"], false);

    let (_, customers) = get(&app, "member", "/crm/companies?stage=customer").await;
    assert_eq!(names(&customers), ["Acme"]);
    let (_, owned) = get(
        &app,
        "member",
        &format!("/crm/companies?ownerUserId={}", OWNER.replace('|', "%7C")),
    )
    .await;
    assert_eq!(names(&owned), ["Acme"]);
    let (_, searched) = get(&app, "member", "/crm/companies?search=GLOB").await;
    assert_eq!(names(&searched), ["Globex"]);
    let (_, first) = get(&app, "member", "/crm/companies?limit=1").await;
    assert_eq!(names(&first), ["Globex"]);
    assert_eq!(first["totalMatching"], 2);

    let (status, unknown) = get(&app, "member", "/crm/companies?stage=nonsense").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(unknown["message"].as_str().unwrap().contains("Customer"));

    let (status, _) = get(&app, "member", "/crm/companies?includeHidden=true").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, with_hidden) = get(&app, "owner", "/crm/companies?includeHidden=true").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(names(&with_hidden), ["Globex", "Acme", "Initech"]);
    assert_eq!(with_hidden["companies"][2]["id"], initech.to_string());
    assert_eq!(with_hidden["companies"][2]["hidden"], true);

    let (status, _) = get(&app, "nobody", "/crm/companies").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_user_lists_only_their_own_teams_companies(pool: PgPool) {
    seed(&pool).await;
    seed_other_team(&pool).await;
    let app = app(&pool);

    for token in ["member", "owner"] {
        let (status, listing) = get(&app, token, "/crm/companies?includeHidden=false").await;
        assert_eq!(status, StatusCode::OK, "{listing}");
        assert_eq!(names(&listing), ["Globex", "Acme"], "{token}'s team only");
        assert_eq!(listing["totalMatching"], 2);
    }
    // The team owner's hidden listing and a name search stay inside the team.
    let (_, with_hidden) = get(&app, "owner", "/crm/companies?includeHidden=true").await;
    assert_eq!(names(&with_hidden), ["Globex", "Acme", "Initech"]);
    let (_, rival) = get(&app, "owner", "/crm/companies?search=rival").await;
    assert!(names(&rival).is_empty(), "{rival}");

    // And the other team's member sees only theirs, hidden ones only as owner.
    let (status, theirs) = get(&app, "outsider", "/crm/companies").await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(names(&theirs), ["Rival Co"]);
    let (_, theirs_hidden) = get(&app, "outsider", "/crm/companies?includeHidden=true").await;
    assert_eq!(names(&theirs_hidden).len(), 2);
    assert!(!names(&theirs_hidden).contains(&"Globex"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_bot_lists_its_teams_companies(pool: PgPool) {
    use entity_access::domain::models::{
        BotReceiptScope, Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
        TeamRole,
    };

    seed(&pool).await;
    let other_team = seed_other_team(&pool).await;
    let team: Uuid = sqlx::query_scalar("SELECT id FROM team WHERE name = 'Sales'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let context = CrmToolContext {
        service: Arc::new(CrmServiceImpl::new(
            CompaniesRepositoryImpl::new(pool.clone()),
            NoOpCompanyMetadataResolver,
        )),
        entity_access_service: Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
        properties: Arc::new(PropertiesServiceImpl::new(
            PropertiesPgRepo::new(pool.clone()),
            None::<NoPermissions>,
            None::<NoNotifications>,
        )),
    };

    // A team-scoped bot: no acting user, a member-level team receipt.
    let bot_receipt = |team: Uuid| {
        CrmTeamReceipt::<MemberTeamRole>::from_team_receipt(
            EntityAccessReceipt::try_new_bot(
                bot_id::BotIdStr::from(bot_id::BotId::new_from_uuid(Uuid::now_v7())),
                BotReceiptScope::Team { team_id: team },
                Entity {
                    entity_id: team.to_string(),
                    entity_type: EntityType::Team,
                },
                EntityPermission::TeamRole {
                    role: TeamRole::Member,
                },
            )
            .unwrap(),
        )
        .unwrap()
    };
    let filters = |stage: Option<&str>, include_hidden: Option<bool>| ListCompanies {
        search: None,
        stage: stage.map(str::to_owned),
        owner_user_id: None,
        include_hidden,
        limit: None,
    };

    let listing = list_companies_for_team(
        &context,
        &bot_receipt(team),
        &filters(Some("customer"), None),
    )
    .await
    .expect("a team bot lists its team's companies");
    let listed: Vec<_> = listing
        .companies
        .iter()
        .map(|c| c.name.as_deref())
        .collect();
    assert_eq!(listed, [Some("Acme")]);
    assert_eq!(listing.companies[0].owner_user_id.as_deref(), Some(OWNER));

    // Another team's bot sees only that team's companies, and a member-level
    // bot cannot ask for hidden ones.
    let rivals = list_companies_for_team(&context, &bot_receipt(other_team), &filters(None, None))
        .await
        .unwrap();
    let rival_names: Vec<_> = rivals.companies.iter().map(|c| c.name.as_deref()).collect();
    assert_eq!(rival_names, [Some("Rival Co")]);
    assert!(matches!(
        list_companies_for_team(&context, &bot_receipt(team), &filters(None, Some(true))).await,
        Err(ListCompaniesError::AdminRequired)
    ));
}
