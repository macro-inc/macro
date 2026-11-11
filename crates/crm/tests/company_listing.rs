//! The team's companies by recent interaction, through the real CRM and
//! properties services, as `ListCompanies` and `GET /crm/companies/list`
//! read them.
#![cfg(feature = "outbound")]

use crm::domain::{
    auth::CrmTeamReceipt,
    company_listing::{CompanyListQuery, CompanyListingError, list_companies},
    service::CrmServiceImpl,
};
use crm::outbound::{
    companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
};
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType as AccessEntityType, MemberTeamRole,
    TeamRole,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_properties::{EntityReference, EntityType, service::property_value::PropertyValue};
use properties::domain::model::{EditReceipt, TaskAssignedNotification, ViewReceipt};
use properties::{
    NotificationService, PermissionService, PropertiesPgRepo, PropertiesServiceImpl,
    domain::database_cell_writer::DatabaseCellWriter,
};
use sqlx::PgPool;
use system_properties::{StageOption, SystemPropertyKey};
use uuid::Uuid;

const OWNER: &str = "macro|listing-owner@macro.com";

type Crm = CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>;
type Properties = PropertiesServiceImpl<PropertiesPgRepo, NoPermissions, NoNotifications>;

struct NoPermissions;

impl PermissionService for NoPermissions {
    type Err = anyhow::Error;

    async fn mint_view_receipt<'a>(
        &self,
        _user_id: Option<&'a MacroUserIdStr<'a>>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<ViewReceipt, Self::Err> {
        unimplemented!("the listing never mints view receipts")
    }

    async fn mint_edit_receipt<'a>(
        &self,
        _user_id: &MacroUserIdStr<'a>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<EditReceipt, Self::Err> {
        unimplemented!("the listing never edits")
    }

    async fn grant_permissions_to_task<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
        _task_id: &str,
    ) -> Result<(), Self::Err> {
        unimplemented!("the listing never grants")
    }
}

struct NoNotifications;

impl NotificationService for NoNotifications {
    type Err = anyhow::Error;

    async fn send_task_assigned<'a>(
        &self,
        _notification: TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        unimplemented!("the listing never notifies")
    }
}

struct Fixture {
    crm: Crm,
    properties: Properties,
    team: Uuid,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let uid = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2)",
        uid,
        OWNER
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1,$1,$2)"#,
        OWNER,
        uid
    )
    .execute(pool)
    .await
    .unwrap();
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Sales', $2)",
        team,
        OWNER
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        OWNER
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)",
        team
    )
    .execute(pool)
    .await
    .unwrap();
    Fixture {
        crm: Crm::new(
            CompaniesRepositoryImpl::new(pool.clone()),
            NoOpCompanyMetadataResolver,
        ),
        properties: PropertiesServiceImpl::new(
            PropertiesPgRepo::new(pool.clone()),
            None::<NoPermissions>,
            None::<NoNotifications>,
        ),
        team,
    }
}

/// A company last heard from `days_ago` days ago.
async fn company(pool: &PgPool, team: Uuid, name: &str, days_ago: i32, hidden: bool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO crm_companies (id, team_id, custom_name, hidden, first_interaction, last_interaction)
         VALUES ($1, $2, $3, $4, now() - make_interval(days => $5 + 30), now() - make_interval(days => $5))",
        id,
        team,
        name,
        hidden,
        days_ago
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)",
        id,
        team,
        format!("{}.example.com", name.to_lowercase())
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn stage(pool: &PgPool, company: Uuid, option: StageOption) {
    let mut tx = pool.begin().await.unwrap();
    PropertiesPgRepo::new(pool.clone())
        .upsert_entity_property_in(
            &mut tx,
            &EntityReference {
                entity_type: EntityType::Company,
                entity_id: company.to_string(),
                specific_message_id: None,
            },
            SystemPropertyKey::Stage.uuid(),
            Some(PropertyValue::SelectOption(vec![option.uuid()])),
        )
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

fn receipt(team: Uuid, role: TeamRole) -> CrmTeamReceipt<MemberTeamRole> {
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
            MacroUserIdStr::parse_from_str(OWNER).unwrap().into_owned(),
            Entity {
                entity_id: team.to_string(),
                entity_type: AccessEntityType::Team,
            },
            EntityPermission::TeamRole { role },
        )
        .unwrap(),
    )
    .unwrap()
}

fn names(listing: &crm::domain::company_listing::CompanyListing) -> Vec<&str> {
    listing
        .companies
        .iter()
        .map(|company| company.name.as_deref().unwrap_or_default())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn companies_list_by_most_recent_interaction_with_their_stage(pool: PgPool) {
    let Fixture {
        crm,
        properties,
        team,
    } = fixture(&pool).await;
    let initech = company(&pool, team, "Initech", 9, false).await;
    let acme = company(&pool, team, "Acme", 1, false).await;
    company(&pool, team, "Globex", 4, false).await;
    company(&pool, team, "Umbrella", 2, true).await;
    stage(&pool, acme, StageOption::Customer).await;
    stage(&pool, initech, StageOption::Customer).await;
    let member = receipt(team, TeamRole::Member);

    let all = list_companies(&crm, &properties, &member, &CompanyListQuery::default())
        .await
        .unwrap();
    assert_eq!(names(&all), ["Acme", "Globex", "Initech"]);
    assert_eq!(all.total_matching, 3);
    let acme_row = &all.companies[0];
    assert_eq!(acme_row.domains, ["acme.example.com"]);
    assert_eq!(
        acme_row.stage.as_ref().map(|stage| stage.label.as_str()),
        Some("Customer")
    );
    assert!(all.companies[1].stage.is_none());

    let customers = list_companies(
        &crm,
        &properties,
        &member,
        &CompanyListQuery {
            stage: Some("customer".into()),
            limit: Some(1),
            ..CompanyListQuery::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(names(&customers), ["Acme"]);
    assert_eq!(customers.total_matching, 2, "counted before the limit");

    let searched = list_companies(
        &crm,
        &properties,
        &member,
        &CompanyListQuery {
            search: Some("GLOBEX.example".into()),
            ..CompanyListQuery::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(names(&searched), ["Globex"]);

    assert!(matches!(
        list_companies(
            &crm,
            &properties,
            &member,
            &CompanyListQuery {
                stage: Some("Somewhere".into()),
                ..CompanyListQuery::default()
            },
        )
        .await,
        Err(CompanyListingError::UnknownStage { known, .. }) if known.contains(&"Customer".to_owned())
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_admins_list_hidden_companies(pool: PgPool) {
    let Fixture {
        crm,
        properties,
        team,
    } = fixture(&pool).await;
    company(&pool, team, "Acme", 3, false).await;
    company(&pool, team, "Umbrella", 1, true).await;
    let with_hidden = CompanyListQuery {
        include_hidden: true,
        ..CompanyListQuery::default()
    };

    assert!(matches!(
        list_companies(
            &crm,
            &properties,
            &receipt(team, TeamRole::Member),
            &with_hidden
        )
        .await,
        Err(CompanyListingError::HiddenRequiresAdmin)
    ));
    let listing = list_companies(
        &crm,
        &properties,
        &receipt(team, TeamRole::Admin),
        &with_hidden,
    )
    .await
    .unwrap();
    assert_eq!(names(&listing), ["Umbrella", "Acme"]);
    assert!(listing.companies[0].hidden);
}
