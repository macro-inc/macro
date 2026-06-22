//! Tests for the AiProjectionRepositoryImpl.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

use super::*;
use crate::domain::ai_projection_service::READ_PROFESSIONAL_FEATURES;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn get_or_create_projection_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    let first = repo
        .get_or_create_projection(
            "inbox/important",
            "What is important?",
            "hash_v1",
            TargetType::User,
            RefreshCadence::High,
            Expiry::Day,
        )
        .await?;

    // A second call with a different prompt/target_type must NOT update the existing row.
    let second = repo
        .get_or_create_projection(
            "inbox/important",
            "A totally different prompt",
            "hash_v2",
            TargetType::Team,
            RefreshCadence::Low,
            Expiry::Month,
        )
        .await?;

    assert_eq!(first, second);
    assert_eq!(second.prompt, "What is important?");
    assert_eq!(second.prompt_hash, "hash_v1");
    assert_eq!(second.target_type, TargetType::User);
    assert_eq!(second.refresh_cadence, RefreshCadence::High);
    assert_eq!(second.expiry, Expiry::Day);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn get_or_create_target_projection_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|pro@user.com")?;

    repo.get_or_create_projection(
        "inbox/important",
        "What is important?",
        "hash_v1",
        TargetType::User,
        RefreshCadence::High,
        Expiry::Day,
    )
    .await?;

    let first = repo
        .get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v1")
        .await?;
    let second = repo
        .get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v1")
        .await?;

    assert_eq!(first.id, second.id);
    assert_eq!(first.ai_projection_id, "inbox/important");
    assert_eq!(first.target_id, "macro|pro@user.com");
    assert_eq!(first.status, ProjectionStatus::Cold);
    assert!(first.result.is_none());

    // A new prompt version creates a separate instance.
    let other_version = repo
        .get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v2")
        .await?;
    assert_ne!(first.id, other_version.id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn get_or_create_target_projection_supports_team_targets(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    repo.get_or_create_projection(
        "team/focus",
        "What is my team focused on?",
        "hash_v1",
        TargetType::Team,
        RefreshCadence::Medium,
        Expiry::Week,
    )
    .await?;

    // A team target id (not a user id) is stored verbatim.
    let team_id = "11111111-1111-1111-1111-111111111111";
    let instance = repo
        .get_or_create_target_projection("team/focus", team_id, "hash_v1")
        .await?;

    assert_eq!(instance.target_id, team_id);
    assert_eq!(instance.status, ProjectionStatus::Cold);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn get_user_team_ids_returns_memberships(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    let pro = MacroUserIdStr::parse_from_str("macro|pro@user.com")?;
    let free = MacroUserIdStr::parse_from_str("macro|free@user.com")?;

    let pro_teams = repo.get_user_team_ids(&pro).await?;
    assert_eq!(pro_teams.len(), 1);
    assert_eq!(
        pro_teams[0],
        uuid::Uuid::parse_str("11111111-1111-1111-1111-111111111111")?
    );

    assert!(repo.get_user_team_ids(&free).await?.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn user_has_permission_reflects_roles(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    let pro = MacroUserIdStr::parse_from_str("macro|pro@user.com")?;
    let free = MacroUserIdStr::parse_from_str("macro|free@user.com")?;

    assert!(
        repo.user_has_permission(&pro, READ_PROFESSIONAL_FEATURES)
            .await?
    );
    assert!(
        !repo
            .user_has_permission(&free, READ_PROFESSIONAL_FEATURES)
            .await?
    );

    Ok(())
}
