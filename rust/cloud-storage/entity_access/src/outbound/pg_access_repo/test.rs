use super::PgAccessRepository;
use crate::domain::{
    models::{AccessError, AccessLevel},
    ports::AccessRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const TEAM_ALPHA: &str = "00000000-0000-0000-0000-0000000ea001";
const TEAM_BETA: &str = "00000000-0000-0000-0000-0000000ea002";
const TEAM_MEMBER: &str = "macro|member@team.com";
const TEAM_ADMIN: &str = "macro|admin@team.com";
const TEAM_OWNER: &str = "macro|owner@team.com";
const USER_WITHOUT_TEAM: &str = "macro|noteam@team.com";
const TEAM_BETA_OWNER: &str = "macro|multi@team.com";

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).unwrap()
}

async fn insert_foreign_entity(
    pool: &PgPool,
    id: Uuid,
    stored_for_id: &str,
    stored_for_auth_entity: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO foreign_entity (
            id,
            foreign_entity_id,
            foreign_entity_source,
            metadata,
            stored_for_id,
            stored_for_auth_entity
        )
        VALUES ($1, $2, $3, '{}'::jsonb, $4, $5)
        "#,
        id,
        format!("external-{id}"),
        "test-source",
        stored_for_id,
        stored_for_auth_entity,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn grants_direct_user_access(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, USER_WITHOUT_TEAM, "user").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(USER_WITHOUT_TEAM);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn grants_team_access(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, TEAM_ALPHA, "team").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(TEAM_MEMBER);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn denies_unrelated_user_and_team_access(pool: PgPool) -> anyhow::Result<()> {
    let unrelated_user_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, unrelated_user_entity_id, USER_WITHOUT_TEAM, "user").await?;

    let unrelated_team_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, unrelated_team_entity_id, TEAM_BETA, "team").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(TEAM_MEMBER);

    let user_access = repo
        .has_foreign_entity_access(&unrelated_user_entity_id.to_string(), Some(&user_id))
        .await?;
    let team_access = repo
        .has_foreign_entity_access(&unrelated_team_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(!user_access);
    assert!(!team_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn denies_unauthenticated_access(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, USER_WITHOUT_TEAM, "user").await?;

    let repo = PgAccessRepository::new(pool);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), None)
        .await?;

    assert!(!has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn denies_auth_namespace_mismatch(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, USER_WITHOUT_TEAM, "team").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(USER_WITHOUT_TEAM);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(!has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn rejects_invalid_uuid(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(USER_WITHOUT_TEAM);

    let error = repo
        .has_foreign_entity_access("not-a-uuid", Some(&user_id))
        .await
        .expect_err("invalid UUID should be rejected");

    assert!(matches!(
        error,
        AccessError::BadRequest("Invalid foreign entity ID format")
    ));
    Ok(())
}

// --------------------------------------------------------------------------
// CRM company + contact access
// --------------------------------------------------------------------------

async fn insert_crm_company(pool: &PgPool, team_id: &str, hidden: bool) -> anyhow::Result<Uuid> {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO crm_companies (id, team_id, hidden, first_interaction, last_interaction)
        VALUES ($1, $2, $3, now(), now())
        "#,
        id,
        Uuid::parse_str(team_id)?,
        hidden,
    )
    .execute(pool)
    .await?;
    Ok(id)
}

async fn insert_crm_contact(pool: &PgPool, company_id: Uuid, hidden: bool) -> anyhow::Result<Uuid> {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO crm_contacts (id, company_id, email, hidden, first_interaction, last_interaction)
        VALUES ($1, $2, $3, $4, now(), now())
        "#,
        id,
        company_id,
        format!("contact-{id}@example.com"),
        hidden,
    )
    .execute(pool)
    .await?;
    Ok(id)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_company_access_maps_team_role_to_access_level(pool: PgPool) -> anyhow::Result<()> {
    let company_id = insert_crm_company(&pool, TEAM_ALPHA, false).await?;
    let repo = PgAccessRepository::new(pool);

    let cases = [
        (TEAM_MEMBER, Some(AccessLevel::View)),
        (TEAM_ADMIN, Some(AccessLevel::Edit)),
        (TEAM_OWNER, Some(AccessLevel::Owner)),
    ];
    for (uid, expected) in cases {
        let actual = repo
            .get_crm_company_access(&company_id.to_string(), Some(&user_id(uid)))
            .await?;
        assert_eq!(actual, expected, "user {uid}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_company_access_hides_from_member_when_hidden(pool: PgPool) -> anyhow::Result<()> {
    let company_id = insert_crm_company(&pool, TEAM_ALPHA, true).await?;
    let repo = PgAccessRepository::new(pool);

    assert_eq!(
        repo.get_crm_company_access(&company_id.to_string(), Some(&user_id(TEAM_MEMBER)))
            .await?,
        None,
    );
    assert_eq!(
        repo.get_crm_company_access(&company_id.to_string(), Some(&user_id(TEAM_ADMIN)))
            .await?,
        Some(AccessLevel::Edit),
    );
    assert_eq!(
        repo.get_crm_company_access(&company_id.to_string(), Some(&user_id(TEAM_OWNER)))
            .await?,
        Some(AccessLevel::Owner),
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_company_access_denies_other_team(pool: PgPool) -> anyhow::Result<()> {
    let alpha_company = insert_crm_company(&pool, TEAM_ALPHA, false).await?;
    let repo = PgAccessRepository::new(pool);

    // Beta's owner has no role on Alpha → no access to an Alpha company.
    let actual = repo
        .get_crm_company_access(&alpha_company.to_string(), Some(&user_id(TEAM_BETA_OWNER)))
        .await?;
    assert_eq!(actual, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_company_access_denies_anonymous(pool: PgPool) -> anyhow::Result<()> {
    let company_id = insert_crm_company(&pool, TEAM_ALPHA, false).await?;
    let repo = PgAccessRepository::new(pool);

    let actual = repo
        .get_crm_company_access(&company_id.to_string(), None)
        .await?;
    assert_eq!(actual, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_company_access_rejects_invalid_uuid(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool);
    let err = repo
        .get_crm_company_access("not-a-uuid", Some(&user_id(TEAM_MEMBER)))
        .await
        .expect_err("invalid UUID should be rejected");
    assert!(matches!(
        err,
        AccessError::BadRequest("Invalid CRM company ID format")
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_contact_access_maps_team_role_to_access_level(pool: PgPool) -> anyhow::Result<()> {
    let company_id = insert_crm_company(&pool, TEAM_ALPHA, false).await?;
    let contact_id = insert_crm_contact(&pool, company_id, false).await?;
    let repo = PgAccessRepository::new(pool);

    let cases = [
        (TEAM_MEMBER, Some(AccessLevel::View)),
        (TEAM_ADMIN, Some(AccessLevel::Edit)),
        (TEAM_OWNER, Some(AccessLevel::Owner)),
    ];
    for (uid, expected) in cases {
        let actual = repo
            .get_crm_contact_access(&contact_id.to_string(), Some(&user_id(uid)))
            .await?;
        assert_eq!(actual, expected, "user {uid}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_contact_access_hidden_contact_blocks_member(pool: PgPool) -> anyhow::Result<()> {
    let company_id = insert_crm_company(&pool, TEAM_ALPHA, false).await?;
    let contact_id = insert_crm_contact(&pool, company_id, true).await?;
    let repo = PgAccessRepository::new(pool);

    assert_eq!(
        repo.get_crm_contact_access(&contact_id.to_string(), Some(&user_id(TEAM_MEMBER)))
            .await?,
        None,
    );
    assert_eq!(
        repo.get_crm_contact_access(&contact_id.to_string(), Some(&user_id(TEAM_ADMIN)))
            .await?,
        Some(AccessLevel::Edit),
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_contact_access_hidden_company_cascades_to_contact(pool: PgPool) -> anyhow::Result<()> {
    let company_id = insert_crm_company(&pool, TEAM_ALPHA, true).await?;
    let contact_id = insert_crm_contact(&pool, company_id, false).await?;
    let repo = PgAccessRepository::new(pool);

    assert_eq!(
        repo.get_crm_contact_access(&contact_id.to_string(), Some(&user_id(TEAM_MEMBER)))
            .await?,
        None,
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_contact_access_denies_other_team(pool: PgPool) -> anyhow::Result<()> {
    let company_id = insert_crm_company(&pool, TEAM_ALPHA, false).await?;
    let contact_id = insert_crm_contact(&pool, company_id, false).await?;
    let repo = PgAccessRepository::new(pool);

    let actual = repo
        .get_crm_contact_access(&contact_id.to_string(), Some(&user_id(TEAM_BETA_OWNER)))
        .await?;
    assert_eq!(actual, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn crm_contact_access_rejects_invalid_uuid(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool);
    let err = repo
        .get_crm_contact_access("not-a-uuid", Some(&user_id(TEAM_MEMBER)))
        .await
        .expect_err("invalid UUID should be rejected");
    assert!(matches!(
        err,
        AccessError::BadRequest("Invalid CRM contact ID format")
    ));
    Ok(())
}
