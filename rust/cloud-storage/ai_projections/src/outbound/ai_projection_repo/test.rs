//! Tests for the AiProjectionRepositoryImpl.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

use super::*;
use crate::domain::ai_projection_service::READ_PROFESSIONAL_FEATURES;

/// Upserts a plain user-targeted definition with the given id and hash.
async fn upsert_definition(
    repo: &AiProjectionRepositoryImpl,
    id: &str,
    prompt: &str,
    prompt_hash: &str,
) -> Result<AiProjection, AiProjectionError> {
    repo.upsert_projection_definition(
        id,
        prompt,
        prompt_hash,
        TargetType::User,
        RefreshCadence::High,
        Expiry::Day,
        None,
        None,
    )
    .await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn upsert_projection_definition_is_idempotent_for_same_version(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    let first =
        upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;
    let second =
        upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;

    assert_eq!(first, second);
    assert_eq!(second.prompt, "What is important?");
    assert_eq!(second.prompt_hash, "hash_v1");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn upsert_projection_definition_revises_on_version_change(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;

    // A new prompt hash revises the stored definition in place.
    let schema = serde_json::json!({"type": "object"});
    let revised = repo
        .upsert_projection_definition(
            "inbox/important",
            "A totally different prompt",
            "hash_v2",
            TargetType::User,
            RefreshCadence::Low,
            Expiry::Month,
            Some("cerebras/llama-3.3-70b"),
            Some(&schema),
        )
        .await?;

    assert_eq!(revised.prompt, "A totally different prompt");
    assert_eq!(revised.prompt_hash, "hash_v2");
    assert_eq!(revised.refresh_cadence, RefreshCadence::Low);
    assert_eq!(revised.expiry, Expiry::Month);
    assert_eq!(revised.model.as_deref(), Some("cerebras/llama-3.3-70b"));
    assert_eq!(revised.output_schema.as_ref(), Some(&schema));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn get_or_create_target_projection_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|pro@user.com")?;

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;

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
async fn get_or_create_target_projection_resets_to_cold_on_version_change(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|pro@user.com")?;

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;
    repo.get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v1")
        .await?;

    // Materialize the v1 instance.
    let generated_at = chrono::Utc::now();
    repo.set_projection_result(
        "inbox/important",
        user.as_ref(),
        "hash_v1",
        "v1 result",
        generated_at,
        generated_at + Expiry::Day.to_duration(),
    )
    .await?;

    // Requesting the instance under a new version resets it to cold but keeps
    // the previous result visible until regeneration overwrites it.
    let reset = repo
        .get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v2")
        .await?;
    assert_eq!(reset.status, ProjectionStatus::Cold);
    assert_eq!(reset.prompt_hash, "hash_v2");
    assert_eq!(reset.result.as_deref(), Some("v1 result"));

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

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;

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

    repo.upsert_projection_definition(
        "team/focus",
        "What is my team focused on?",
        "hash_v1",
        TargetType::Team,
        RefreshCadence::Medium,
        Expiry::Week,
        None,
        None,
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
async fn get_target_projection_returns_instance_or_not_found(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|pro@user.com")?;

    assert!(matches!(
        repo.get_target_projection("inbox/important", user.as_ref())
            .await,
        Err(AiProjectionError::NotFound)
    ));

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;
    repo.get_or_create_target_projection("inbox/important", user.as_ref(), "hash_v1")
        .await?;

    let instance = repo
        .get_target_projection("inbox/important", user.as_ref())
        .await?;
    assert_eq!(instance.ai_projection_id, "inbox/important");
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

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;

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

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;

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

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;
    repo.get_or_create_target_projection("inbox/important", target, "hash_v1")
        .await?;

    let generated_at = chrono::Utc::now();
    let stale_at = generated_at + Expiry::Day.to_duration();
    repo.set_projection_result(
        "inbox/important",
        target,
        "hash_v1",
        "the result",
        generated_at,
        stale_at,
    )
    .await?;

    let ready = repo
        .get_target_projection("inbox/important", target)
        .await?;
    assert_eq!(ready.status, ProjectionStatus::Ready);
    assert_eq!(ready.result.as_deref(), Some("the result"));
    assert!(ready.generated_at.is_some());

    repo.set_projection_error("inbox/important", target, "hash_v1", "it broke")
        .await?;
    let errored = repo
        .get_target_projection("inbox/important", target)
        .await?;
    assert_eq!(errored.status, ProjectionStatus::Error);
    assert_eq!(errored.error.as_deref(), Some("it broke"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn projection_writes_are_scoped_to_the_message_version(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let target = "macro|pro@user.com";

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;
    repo.get_or_create_target_projection("inbox/important", target, "hash_v1")
        .await?;

    // The instance moved to v2 (e.g. the prompt changed mid-flight); writes
    // carrying the old v1 hash must not clobber it.
    repo.get_or_create_target_projection("inbox/important", target, "hash_v2")
        .await?;

    let generated_at = chrono::Utc::now();
    repo.set_projection_result(
        "inbox/important",
        target,
        "hash_v1",
        "stale v1 result",
        generated_at,
        generated_at + Expiry::Day.to_duration(),
    )
    .await?;
    repo.set_projection_error("inbox/important", target, "hash_v1", "stale v1 error")
        .await?;
    repo.set_projection_loading("inbox/important", target, "hash_v1")
        .await?;

    let instance = repo
        .get_target_projection("inbox/important", target)
        .await?;
    assert_eq!(instance.status, ProjectionStatus::Cold);
    assert!(instance.result.is_none());
    assert!(instance.error.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ai_projections"))
)]
async fn set_projection_refreshing_updates_status(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = AiProjectionRepositoryImpl::new(pool);
    let target = "macro|pro@user.com";

    upsert_definition(&repo, "inbox/important", "What is important?", "hash_v1").await?;
    repo.get_or_create_target_projection("inbox/important", target, "hash_v1")
        .await?;

    repo.set_projection_refreshing("inbox/important", target)
        .await?;

    let instance = repo
        .get_target_projection("inbox/important", target)
        .await?;
    assert_eq!(instance.status, ProjectionStatus::Refreshing);

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
