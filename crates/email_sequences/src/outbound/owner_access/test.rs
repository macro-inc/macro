use super::*;
use crm::{
    domain::service::CrmServiceImpl,
    outbound::{
        companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    },
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

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
