use super::PgAccessRepository;
use crate::domain::{
    models::{
        AccessError, AccessLevel, BotId, ChannelRoleResult, CrmEntityAccess, EntityType,
        ParticipantRole, TeamRole,
    },
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

    // Each role resolves to its access level paired with the company's owning team.
    let team_alpha = Uuid::parse_str(TEAM_ALPHA)?;
    let cases = [
        (
            TEAM_MEMBER,
            Some(CrmEntityAccess {
                access_level: AccessLevel::Edit,
                team_id: team_alpha,
                team_role: TeamRole::Member,
            }),
        ),
        (
            TEAM_ADMIN,
            Some(CrmEntityAccess {
                access_level: AccessLevel::Edit,
                team_id: team_alpha,
                team_role: TeamRole::Admin,
            }),
        ),
        (
            TEAM_OWNER,
            Some(CrmEntityAccess {
                access_level: AccessLevel::Owner,
                team_id: team_alpha,
                team_role: TeamRole::Owner,
            }),
        ),
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
    let team_alpha = Uuid::parse_str(TEAM_ALPHA)?;

    assert_eq!(
        repo.get_crm_company_access(&company_id.to_string(), Some(&user_id(TEAM_MEMBER)))
            .await?,
        None,
    );
    assert_eq!(
        repo.get_crm_company_access(&company_id.to_string(), Some(&user_id(TEAM_ADMIN)))
            .await?,
        Some(CrmEntityAccess {
            access_level: AccessLevel::Edit,
            team_id: team_alpha,
            team_role: TeamRole::Admin,
        }),
    );
    assert_eq!(
        repo.get_crm_company_access(&company_id.to_string(), Some(&user_id(TEAM_OWNER)))
            .await?,
        Some(CrmEntityAccess {
            access_level: AccessLevel::Owner,
            team_id: team_alpha,
            team_role: TeamRole::Owner,
        }),
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

    // The owning team is the contact's parent company's team.
    let team_alpha = Uuid::parse_str(TEAM_ALPHA)?;
    let cases = [
        (
            TEAM_MEMBER,
            Some(CrmEntityAccess {
                access_level: AccessLevel::Edit,
                team_id: team_alpha,
                team_role: TeamRole::Member,
            }),
        ),
        (
            TEAM_ADMIN,
            Some(CrmEntityAccess {
                access_level: AccessLevel::Edit,
                team_id: team_alpha,
                team_role: TeamRole::Admin,
            }),
        ),
        (
            TEAM_OWNER,
            Some(CrmEntityAccess {
                access_level: AccessLevel::Owner,
                team_id: team_alpha,
                team_role: TeamRole::Owner,
            }),
        ),
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
    let team_alpha = Uuid::parse_str(TEAM_ALPHA)?;

    assert_eq!(
        repo.get_crm_contact_access(&contact_id.to_string(), Some(&user_id(TEAM_MEMBER)))
            .await?,
        None,
    );
    assert_eq!(
        repo.get_crm_contact_access(&contact_id.to_string(), Some(&user_id(TEAM_ADMIN)))
            .await?,
        Some(CrmEntityAccess {
            access_level: AccessLevel::Edit,
            team_id: team_alpha,
            team_role: TeamRole::Admin,
        }),
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

const PG_BOT_OWNER: &str = "macro|pg-bot-owner@example.com";

async fn insert_pg_bot_user(pool: &PgPool) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, 'pg-bot-owner@example.com', $2)
        "#,
        macro_user_id,
        PG_BOT_OWNER,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, 'pg-bot-owner@example.com', $2)
        "#,
        PG_BOT_OWNER,
        macro_user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_pg_bot_team(pool: &PgPool, team_id: Uuid) -> anyhow::Result<()> {
    insert_pg_bot_user(pool).await?;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'PG Bot Team', $2)",
        team_id,
        PG_BOT_OWNER,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_pg_bot(
    pool: &PgPool,
    bot_id: BotId,
    owner_user_id: Option<&str>,
    team_id: Option<Uuid>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle)
        VALUES ($1, 'owned', $2, $3, 'PG Bot', $4)
        "#,
        bot_id.as_uuid(),
        owner_user_id,
        team_id,
        format!("pg-bot-{bot_id}"),
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_pg_bot_channel(
    pool: &PgPool,
    channel_id: Uuid,
    channel_type: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, 'PG Bot Channel', $2::text::comms_channel_type, $3)
        "#,
        channel_id,
        channel_type,
        PG_BOT_OWNER,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_pg_bot_participant(
    pool: &PgPool,
    channel_id: Uuid,
    bot_id: BotId,
    role: &str,
) -> anyhow::Result<()> {
    let principal = bot_id.into_storage_id();
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id)
        VALUES ($1, $2::text::comms_participant_role, $3)
        "#,
        channel_id,
        role,
        principal.as_ref(),
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_pg_bot_entity_access(
    pool: &PgPool,
    entity_id: Uuid,
    entity_type: &str,
    source_id: &str,
    source_type: &str,
    access_level: AccessLevel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level
        )
        VALUES (
            $1,
            $2,
            $3,
            $4::text::entity_access_source_type,
            $5::text::"AccessLevel"
        )
        "#,
        entity_id,
        entity_type,
        source_id,
        source_type,
        access_level.to_string(),
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pg_bot_document_grant_through_active_channel(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let channel_id = Uuid::new_v4();
    let document_id = Uuid::new_v4();
    insert_pg_bot(&pool, bot_id, Some(PG_BOT_OWNER), None).await?;
    insert_pg_bot_channel(&pool, channel_id, "private").await?;
    insert_pg_bot_participant(&pool, channel_id, bot_id, "member").await?;
    insert_pg_bot_entity_access(
        &pool,
        document_id,
        "document",
        &channel_id.to_string(),
        "channel",
        AccessLevel::Edit,
    )
    .await?;

    let access = PgAccessRepository::new(pool)
        .get_bot_entity_access(bot_id, &document_id.to_string(), EntityType::Document)
        .await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pg_bot_team_grant_is_available_only_to_team_scoped_bot(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::new_v4();
    let team_bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let user_bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let document_id = Uuid::new_v4();
    insert_pg_bot_team(&pool, team_id).await?;
    insert_pg_bot(&pool, team_bot_id, None, Some(team_id)).await?;
    insert_pg_bot(&pool, user_bot_id, Some(PG_BOT_OWNER), None).await?;
    insert_pg_bot_entity_access(
        &pool,
        document_id,
        "document",
        &team_id.to_string(),
        "team",
        AccessLevel::Comment,
    )
    .await?;
    let repo = PgAccessRepository::new(pool);

    let team_access = repo
        .get_bot_entity_access(team_bot_id, &document_id.to_string(), EntityType::Document)
        .await?;
    let user_access = repo
        .get_bot_entity_access(user_bot_id, &document_id.to_string(), EntityType::Document)
        .await?;

    assert_eq!(team_access, Some(AccessLevel::Comment));
    assert_eq!(user_access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pg_bot_ungranted_document_returns_none(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let document_id = Uuid::new_v4();
    insert_pg_bot(&pool, bot_id, Some(PG_BOT_OWNER), None).await?;

    let access = PgAccessRepository::new(pool)
        .get_bot_entity_access(bot_id, &document_id.to_string(), EntityType::Document)
        .await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pg_bot_email_thread_receives_view_from_containing_project(
    pool: PgPool,
) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let channel_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    insert_pg_bot_user(&pool).await?;
    insert_pg_bot(&pool, bot_id, Some(PG_BOT_OWNER), None).await?;
    insert_pg_bot_channel(&pool, channel_id, "private").await?;
    insert_pg_bot_participant(&pool, channel_id, bot_id, "member").await?;
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'PG Bot Project', $2)"#,
        project_id.to_string(),
        PG_BOT_OWNER,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, 'pg-bot-owner@example.com', 'GMAIL')
        "#,
        link_id,
        PG_BOT_OWNER,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id, project_id) VALUES ($1, $2, $3)",
        thread_id,
        link_id,
        project_id.to_string(),
    )
    .execute(&pool)
    .await?;
    insert_pg_bot_entity_access(
        &pool,
        project_id,
        "project",
        &channel_id.to_string(),
        "channel",
        AccessLevel::Owner,
    )
    .await?;

    let access = PgAccessRepository::new(pool)
        .get_bot_entity_access(bot_id, &thread_id.to_string(), EntityType::EmailThread)
        .await?;

    assert_eq!(access, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pg_bot_channel_role_requires_explicit_canonical_participation(
    pool: PgPool,
) -> anyhow::Result<()> {
    let participating_bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let other_bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let channel_id = Uuid::new_v4();
    insert_pg_bot(&pool, participating_bot_id, Some(PG_BOT_OWNER), None).await?;
    insert_pg_bot(&pool, other_bot_id, Some(PG_BOT_OWNER), None).await?;
    insert_pg_bot_channel(&pool, channel_id, "public").await?;
    insert_pg_bot_participant(&pool, channel_id, participating_bot_id, "admin").await?;
    let repo = PgAccessRepository::new(pool);

    let participating_role = repo
        .get_bot_channel_role(&channel_id, participating_bot_id)
        .await?;
    let non_participating_role = repo.get_bot_channel_role(&channel_id, other_bot_id).await?;

    assert_eq!(
        participating_role,
        ChannelRoleResult::Role(ParticipantRole::Admin)
    );
    assert_eq!(non_participating_role, ChannelRoleResult::NoAccess);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pg_bot_entity_access_rejects_malformed_uuid(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let error = PgAccessRepository::new(pool)
        .get_bot_entity_access(bot_id, "not-a-uuid", EntityType::Document)
        .await
        .expect_err("malformed entity ID should be rejected");

    assert!(matches!(
        error,
        AccessError::BadRequest("Invalid entity ID format")
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pg_bot_entity_access_rejects_unsupported_entity_type(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let error = PgAccessRepository::new(pool)
        .get_bot_entity_access(bot_id, &Uuid::new_v4().to_string(), EntityType::CrmCompany)
        .await
        .expect_err("unsupported bot entity type should be rejected");

    assert!(matches!(
        error,
        AccessError::BadRequest("Unsupported entity type for bot access")
    ));
    Ok(())
}
