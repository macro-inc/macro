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

    // Same (target_id, ai_projection_id) -> the same row is returned, not a new
    // one. The composite primary key guarantees no duplicate can be inserted.
    assert_eq!(first, second);
    assert_eq!(first.ai_projection_id, "inbox/important");
    assert_eq!(first.target_id, "macro|pro@user.com");
    assert_eq!(first.status, ProjectionStatus::Cold);
    assert!(first.result.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn get_or_create_target_projection_bumps_last_requested_at(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool.clone());
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

    repo.get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v1")
        .await?;

    // Backdate the instance so a fresh request must visibly move the timestamp
    // forward (deterministic, no sleeps).
    sqlx::query!(
        r#"
        UPDATE user_ai_projection
        SET last_requested_at = NOW() - INTERVAL '10 days'
        WHERE ai_projection_id = $1 AND target_id = $2
        "#,
        "inbox/important",
        user.as_ref(),
    )
    .execute(&pool)
    .await?;

    // A subsequent request bumps last_requested_at back to ~now, marking the
    // instance as active so the refresh handler won't reap it.
    repo.get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v1")
        .await?;

    let last_requested_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar!(
        r#"
        SELECT last_requested_at
        FROM user_ai_projection
        WHERE ai_projection_id = $1 AND target_id = $2
        "#,
        "inbox/important",
        user.as_ref(),
    )
    .fetch_one(&pool)
    .await?;

    assert!(
        last_requested_at > chrono::Utc::now() - chrono::Duration::minutes(1),
        "expected last_requested_at to be bumped to ~now, got {last_requested_at}"
    );

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
async fn get_projection_returns_definition_or_not_found(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    assert!(matches!(
        repo.get_projection("missing").await,
        Err(AiProjectionError::NotFound)
    ));

    repo.get_or_create_projection(
        "inbox/important",
        "What is important?",
        "hash_v1",
        TargetType::User,
        RefreshCadence::High,
        Expiry::Day,
    )
    .await?;

    let projection = repo.get_projection("inbox/important").await?;
    assert_eq!(projection.prompt, "What is important?");
    assert_eq!(projection.expiry, Expiry::Day);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn processing_claim_is_exclusive_and_releasable(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    repo.get_or_create_projection(
        "inbox/important",
        "What is important?",
        "hash_v1",
        TargetType::User,
        RefreshCadence::High,
        Expiry::Day,
    )
    .await?;

    let target = "macro|pro@user.com";

    // First claim acquires the lock; a second concurrent claim is refused.
    assert!(repo.try_start_processing("inbox/important", target).await?);
    assert!(!repo.try_start_processing("inbox/important", target).await?);

    // Releasing the claim allows it to be re-acquired (i.e. retried).
    repo.finish_processing("inbox/important", target).await?;
    assert!(repo.try_start_processing("inbox/important", target).await?);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn set_projection_result_and_error_update_status(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let target = "macro|pro@user.com";

    repo.get_or_create_projection(
        "inbox/important",
        "What is important?",
        "hash_v1",
        TargetType::User,
        RefreshCadence::High,
        Expiry::Day,
    )
    .await?;
    repo.get_or_create_target_projection("inbox/important", target, "hash_v1")
        .await?;

    let generated_at = chrono::Utc::now();
    let stale_at = generated_at + Expiry::Day.to_duration();
    repo.set_projection_result(
        "inbox/important",
        target,
        "the result",
        generated_at,
        stale_at,
    )
    .await?;

    let ready = repo
        .get_or_create_target_projection("inbox/important", target, "hash_v1")
        .await?;
    assert_eq!(ready.status, ProjectionStatus::Ready);
    assert_eq!(ready.result.as_deref(), Some("the result"));
    assert!(ready.generated_at.is_some());

    repo.set_projection_error("inbox/important", target, "it broke")
        .await?;
    let errored = repo
        .get_or_create_target_projection("inbox/important", target, "hash_v1")
        .await?;
    assert_eq!(errored.status, ProjectionStatus::Error);
    assert_eq!(errored.error.as_deref(), Some("it broke"));

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
