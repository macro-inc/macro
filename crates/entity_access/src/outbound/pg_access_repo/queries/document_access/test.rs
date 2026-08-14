use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER_WITH_TEAM: &str = "macro|document-owner@team.test";
const OWNER_WITHOUT_TEAM: &str = "macro|document-owner@personal.test";

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $2, $2)
        "#,
        macro_user_id,
        user_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $1, $2)
        "#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn add_owner_to_team(pool: &PgPool, owner: &str, team_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES ($1, 'Document Owner Team', $2)
        "#,
        team_id,
        owner,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'owner')
        "#,
        owner,
        team_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_link_shared_document(
    pool: &PgPool,
    owner: &str,
    link_share: Option<&str>,
    link_share_access_level: Option<&str>,
) -> anyhow::Result<Uuid> {
    let document_id = Uuid::new_v4();
    let document_id_string = document_id.to_string();
    let share_permission_id = Uuid::new_v4().to_string();

    sqlx::query!(
        r#"
        INSERT INTO "Document" (id, name, owner)
        VALUES ($1, 'Link Shared Document', $2)
        "#,
        document_id_string,
        owner,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            id,
            "linkShare",
            "linkShareAccessLevel"
        )
        VALUES ($1, $2, $3::text::"AccessLevel")
        "#,
        share_permission_id,
        link_share,
        link_share_access_level,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId")
        VALUES ($1, $2)
        "#,
        document_id_string,
        share_permission_id,
    )
    .execute(pool)
    .await?;

    Ok(document_id)
}

async fn insert_document_entity_access(
    pool: &PgPool,
    document_id: Uuid,
    source_id: &str,
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
        VALUES ($1, 'document', $2, 'user', $3::text::"AccessLevel")
        "#,
        document_id,
        source_id,
        access_level.to_string(),
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_link_allows_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("PUBLIC"), Some("view"))
            .await?;

    let access = get_document_access(&pool, &document_id, &SourceIds(vec![])).await?;

    assert_eq!(access, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn null_link_denies_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id = insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, None, None).await?;
    let source_ids = SourceIds(vec!["macro|requester@team.test".to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_allows_same_team_access(pool: PgPool) -> anyhow::Result<()> {
    let owner_team_id = Uuid::new_v4();
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, owner_team_id).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITH_TEAM, Some("TEAM"), Some("comment")).await?;
    let source_ids = SourceIds(vec![owner_team_id.to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, Some(AccessLevel::Comment));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_other_team_access(pool: PgPool) -> anyhow::Result<()> {
    let owner_team_id = Uuid::new_v4();
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, owner_team_id).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITH_TEAM, Some("TEAM"), Some("comment")).await?;
    let source_ids = SourceIds(vec![Uuid::new_v4().to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    let owner_team_id = Uuid::new_v4();
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, owner_team_id).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITH_TEAM, Some("TEAM"), Some("edit")).await?;

    let access = get_document_access(&pool, &document_id, &SourceIds(vec![])).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_access_when_owner_has_no_team(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("TEAM"), Some("edit")).await?;
    let source_ids = SourceIds(vec![Uuid::new_v4().to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_link_requires_an_access_level(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("PUBLIC"), None).await?;

    let access = get_document_access(&pool, &document_id, &SourceIds(vec![])).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_highest_link_or_explicit_access_level(pool: PgPool) -> anyhow::Result<()> {
    const REQUESTER: &str = "macro|requester@team.test";

    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("PUBLIC"), Some("comment"))
            .await?;
    insert_document_entity_access(&pool, document_id, REQUESTER, AccessLevel::Edit).await?;
    let source_ids = SourceIds(vec![REQUESTER.to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}
