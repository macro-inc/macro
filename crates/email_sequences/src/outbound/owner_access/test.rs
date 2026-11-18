use super::*;
use crm::{
    domain::service::CrmServiceImpl,
    outbound::{
        companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    },
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;

const ADMIN: &str = "macro|admin@example.com";
const KEPT: Uuid = Uuid::from_u128(0x3e9);
const ARCHIVED: Uuid = Uuid::from_u128(0x3ea);
const UNDER_ARCHIVED_COMPANY: Uuid = Uuid::from_u128(0x3eb);

/// The CRM shows an admin archived records when asked for them by id; a
/// sequence must not email them.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/archived_people.sql")
)]
async fn an_archived_person_is_not_in_customers_even_for_an_admin(pool: sqlx::PgPool) {
    let access = CrmOwnerAccess::new(
        EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
        CrmServiceImpl::new(
            CompaniesRepositoryImpl::new(pool),
            NoOpCompanyMetadataResolver,
        ),
        None::<FakeFeatureFlags>,
    );
    let people = access
        .people(ADMIN, &[KEPT, ARCHIVED, UNDER_ARCHIVED_COMPANY])
        .await
        .unwrap();
    assert_eq!(
        people.iter().map(|person| person.id).collect::<Vec<_>>(),
        vec![KEPT]
    );
}

/// Sequences need the owner's own access to their team's Customers.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/archived_people.sql")
)]
async fn customers_must_be_open_to_the_user(pool: sqlx::PgPool) {
    const TEAM: Uuid = Uuid::from_u128(0xb);
    const MEMBER: &str = "macro|member@example.com";
    let access = CrmOwnerAccess::new(
        EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
        CrmServiceImpl::new(
            CompaniesRepositoryImpl::new(pool.clone()),
            NoOpCompanyMetadataResolver,
        ),
        None::<FakeFeatureFlags>,
    );
    assert_eq!(access.customers_team(ADMIN).await.unwrap(), Some(TEAM));
    assert_eq!(access.customers_team(MEMBER).await.unwrap(), Some(TEAM));
    assert_eq!(
        access
            .customers_team("macro|stranger@example.com")
            .await
            .unwrap(),
        None
    );

    // An admin revoked the member's access to Customers.
    sqlx::query!(
        "UPDATE team_user SET crm_access = FALSE WHERE user_id = $1",
        MEMBER
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(access.customers_team(MEMBER).await.unwrap(), None);
    assert_eq!(access.customers_team(ADMIN).await.unwrap(), Some(TEAM));
}

/// The rollout starts nothing unless the flag is on for this very user: off,
/// unreadable and unconfigured all read as out.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_an_enabled_flag_is_in_the_rollout(pool: sqlx::PgPool) {
    let on = MacroUserIdStr::parse_from_str("macro|on@example.com")
        .unwrap()
        .into_owned();
    let failing = MacroUserIdStr::parse_from_str("macro|failing@example.com")
        .unwrap()
        .into_owned();
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        on,
        Ok(FlagSnapshot::new([(
            SEQUENCES_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(failing, Err("unavailable".to_owned()));
    let access = |flags| {
        CrmOwnerAccess::new(
            EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
            CrmServiceImpl::new(
                CompaniesRepositoryImpl::new(pool.clone()),
                NoOpCompanyMetadataResolver,
            ),
            flags,
        )
    };
    let configured = access(Some(flags));
    assert!(configured.rollout_includes("macro|on@example.com").await);
    assert!(!configured.rollout_includes("macro|off@example.com").await);
    assert!(
        !configured
            .rollout_includes("macro|failing@example.com")
            .await
    );
    assert!(!configured.rollout_includes("not a user").await);
    assert!(!access(None).rollout_includes("macro|on@example.com").await);
}
