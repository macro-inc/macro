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
            RefreshCadence::High,
            Expiry::Day,
        )
        .await?;

    // A second call with a different prompt must NOT update the existing row.
    let second = repo
        .get_or_create_projection(
            "inbox/important",
            "A totally different prompt",
            "hash_v2",
            RefreshCadence::Low,
            Expiry::Month,
        )
        .await?;

    assert_eq!(first, second);
    assert_eq!(second.prompt, "What is important?");
    assert_eq!(second.prompt_hash, "hash_v1");
    assert_eq!(second.refresh_cadence, RefreshCadence::High);
    assert_eq!(second.expiry, Expiry::Day);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn get_or_create_user_projection_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|pro@user.com")?;

    repo.get_or_create_projection(
        "inbox/important",
        "What is important?",
        "hash_v1",
        RefreshCadence::High,
        Expiry::Day,
    )
    .await?;

    let first = repo
        .get_or_create_user_projection("inbox/important", &user, "hash_v1")
        .await?;
    let second = repo
        .get_or_create_user_projection("inbox/important", &user, "hash_v1")
        .await?;

    assert_eq!(first.id, second.id);
    assert_eq!(first.ai_projection_id, "inbox/important");
    assert_eq!(first.user_id, "macro|pro@user.com");
    assert_eq!(first.status, ProjectionStatus::Cold);
    assert!(first.result.is_none());

    // A new prompt version creates a separate instance.
    let other_version = repo
        .get_or_create_user_projection("inbox/important", &user, "hash_v2")
        .await?;
    assert_ne!(first.id, other_version.id);

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
