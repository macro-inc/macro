use chrono::{DateTime, Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    AiProjectionCacheKey, CompleteProjectionRequest, FailProjectionRequest, ProjectionExpiry,
    RefreshCadence, ScheduleGenerationReason, ScheduleProjectionRequest,
    UpsertProjectionInstanceRequest, prompt_hash,
};
use crate::domain::ports::AiProjectionRepository;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_or_create_instance_is_idempotent_and_touches_last_requested_at(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let user = user_id("macro|projection@example.com");
    insert_user(&pool, &user).await?;

    let first_requested_at = test_time();
    let mut request = upsert_request(
        "inbox/important",
        Target::user(user.to_string()),
        user.clone(),
        first_requested_at,
    );

    let first = repo.get_or_create_instance(request.clone()).await?;

    request.requested_at = first_requested_at + Duration::minutes(5);
    request.refresh_cadence = RefreshCadence::Medium;
    request.expiry = ProjectionExpiry::Week;

    let second = repo.get_or_create_instance(request).await?;

    assert_eq!(second.id, first.id);
    assert_eq!(
        second.last_requested_at,
        first_requested_at + Duration::minutes(5)
    );
    assert_eq!(second.refresh_cadence, RefreshCadence::Medium);
    assert_eq!(second.expiry, ProjectionExpiry::Week);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn different_prompt_context_or_schema_uses_separate_rows(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let user = user_id("macro|projection@example.com");
    insert_user(&pool, &user).await?;
    let now = test_time();

    let base = upsert_request(
        "inbox/important",
        Target::user(user.to_string()),
        user.clone(),
        now,
    );
    let with_prompt = UpsertProjectionInstanceRequest {
        cache_key: cache_key(
            "inbox/important",
            Target::user(user.to_string()),
            "What should I summarize first?",
            None,
            None,
        ),
        prompt: "What should I summarize first?".to_string(),
        ..base.clone()
    };
    let with_context = UpsertProjectionInstanceRequest {
        cache_key: cache_key(
            "inbox/important",
            Target::user(user.to_string()),
            "What should I triage first?",
            Some("unread only"),
            None,
        ),
        context: Some("unread only".to_string()),
        ..base.clone()
    };
    let with_schema = UpsertProjectionInstanceRequest {
        cache_key: cache_key(
            "inbox/important",
            Target::user(user.to_string()),
            "What should I triage first?",
            None,
            Some(json!({ "type": "string" })),
        ),
        schema: Some(json!({ "type": "string" })),
        ..base.clone()
    };

    let base_instance = repo.get_or_create_instance(base).await?;
    let prompt_instance = repo.get_or_create_instance(with_prompt).await?;
    let context_instance = repo.get_or_create_instance(with_context).await?;
    let schema_instance = repo.get_or_create_instance(with_schema).await?;

    assert_ne!(base_instance.id, prompt_instance.id);
    assert_ne!(base_instance.id, context_instance.id);
    assert_ne!(base_instance.id, schema_instance.id);
    assert_ne!(prompt_instance.id, context_instance.id);
    assert_ne!(prompt_instance.id, schema_instance.id);
    assert_ne!(context_instance.id, schema_instance.id);
    assert_eq!(projection_count(&pool, "inbox/important").await?, 4);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claim_next_due_projection_claims_due_and_skips_expired(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let user = user_id("macro|projection@example.com");
    insert_user(&pool, &user).await?;
    let now = test_time();

    let expired = upsert_request(
        "expired/projection",
        Target::user(user.to_string()),
        user.clone(),
        now - Duration::days(2),
    );
    let active = upsert_request(
        "active/projection",
        Target::user(user.to_string()),
        user.clone(),
        now - Duration::hours(1),
    );

    repo.get_or_create_instance(expired).await?;
    repo.get_or_create_instance(active.clone()).await?;

    let claimed = repo
        .claim_next_due_projection(now)
        .await?
        .expect("active projection should be claimed");

    assert_eq!(claimed.cache_key, active.cache_key);
    assert_eq!(claimed.status, ProjectionStatus::Refreshing);
    assert_eq!(claimed.claimed_at, Some(now));

    let next = repo
        .claim_next_due_projection(now + Duration::seconds(1))
        .await?;
    assert!(next.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claim_next_due_projection_recovers_stale_claim(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let user = user_id("macro|projection@example.com");
    insert_user(&pool, &user).await?;
    let now = test_time();

    let request = upsert_request(
        "stale-claim/projection",
        Target::user(user.to_string()),
        user,
        now - Duration::hours(1),
    );
    repo.get_or_create_instance(request.clone()).await?;

    let first_claim = repo
        .claim_next_due_projection(now)
        .await?
        .expect("projection should be claimed");
    let immediate_claim = repo
        .claim_next_due_projection(now + Duration::minutes(14))
        .await?;
    let recovered_claim = repo
        .claim_next_due_projection(now + Duration::minutes(16))
        .await?
        .expect("stale claim should be recovered");

    assert!(immediate_claim.is_none());
    assert_eq!(recovered_claim.id, first_claim.id);
    assert_eq!(
        recovered_claim.claimed_at,
        Some(now + Duration::minutes(16))
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn complete_generation_writes_output_and_refresh_schedule(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let user = user_id("macro|projection@example.com");
    insert_user(&pool, &user).await?;
    let now = test_time();
    let request = upsert_request(
        "complete/projection",
        Target::user(user.to_string()),
        user.clone(),
        now,
    );

    repo.get_or_create_instance(request.clone()).await?;
    repo.schedule_generation(schedule_request(&request.cache_key, user.clone(), now))
        .await?;
    repo.claim_next_due_projection(now)
        .await?
        .expect("projection should be claimed");

    let generated_at = now + Duration::minutes(5);
    repo.complete_generation(CompleteProjectionRequest {
        cache_key: request.cache_key.clone(),
        output: "generated output".to_string(),
        generated_at,
    })
    .await?;

    let mut touch_request = request;
    touch_request.requested_at = generated_at + Duration::seconds(1);
    let stored = repo.get_or_create_instance(touch_request).await?;

    assert_eq!(stored.status, ProjectionStatus::Ready);
    assert_eq!(stored.output.as_deref(), Some("generated output"));
    assert_eq!(stored.error, None);
    assert_eq!(stored.generated_at, Some(generated_at));
    assert_eq!(stored.stale_at, Some(generated_at + Duration::hours(1)));
    assert_eq!(stored.next_refresh_at, generated_at + Duration::hours(1));
    assert_eq!(stored.claimed_at, None);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fail_generation_stores_error_and_retries_without_deleting_output(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let user = user_id("macro|projection@example.com");
    insert_user(&pool, &user).await?;
    let now = test_time();
    let request = upsert_request(
        "failure/projection",
        Target::user(user.to_string()),
        user.clone(),
        now,
    );

    repo.get_or_create_instance(request.clone()).await?;
    repo.complete_generation(CompleteProjectionRequest {
        cache_key: request.cache_key.clone(),
        output: "previous output".to_string(),
        generated_at: now,
    })
    .await?;

    let refresh_at = now + Duration::hours(2);
    repo.schedule_generation(schedule_request(
        &request.cache_key,
        user.clone(),
        refresh_at,
    ))
    .await?;
    repo.claim_next_due_projection(refresh_at)
        .await?
        .expect("projection should be claimed");

    let failed_at = refresh_at + Duration::minutes(1);
    repo.fail_generation(FailProjectionRequest {
        cache_key: request.cache_key.clone(),
        error: "model unavailable".to_string(),
        failed_at,
    })
    .await?;

    let mut touch_request = request;
    touch_request.requested_at = failed_at + Duration::seconds(1);
    let stored = repo.get_or_create_instance(touch_request).await?;

    assert_eq!(stored.status, ProjectionStatus::Error);
    assert_eq!(stored.output.as_deref(), Some("previous output"));
    assert_eq!(stored.error.as_deref(), Some("model unavailable"));
    assert_eq!(stored.claimed_at, None);
    assert_eq!(stored.next_refresh_at, failed_at + FAILURE_RETRY_DELAY);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_expired_deletes_only_expired_instances(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let user = user_id("macro|projection@example.com");
    insert_user(&pool, &user).await?;
    let now = test_time();

    repo.get_or_create_instance(upsert_request(
        "expired/projection",
        Target::user(user.to_string()),
        user.clone(),
        now - Duration::days(2),
    ))
    .await?;
    repo.get_or_create_instance(upsert_request(
        "active/projection",
        Target::user(user.to_string()),
        user,
        now - Duration::hours(1),
    ))
    .await?;

    let deleted = repo.cleanup_expired(now).await?;

    assert_eq!(deleted, 1);
    assert_eq!(projection_count(&pool, "expired/projection").await?, 0);
    assert_eq!(projection_count(&pool, "active/projection").await?, 1);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn user_can_access_team_allows_owner_and_team_members(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgAIProjectionRepo::new(pool.clone());
    let owner = user_id("macro|owner@example.com");
    let member = user_id("macro|member@example.com");
    let outsider = user_id("macro|outsider@example.com");
    let team_id = Uuid::new_v4();

    insert_user(&pool, &owner).await?;
    insert_user(&pool, &member).await?;
    insert_user(&pool, &outsider).await?;
    insert_team(&pool, team_id, &owner).await?;
    insert_team_member(&pool, team_id, &member).await?;

    assert!(
        repo.user_can_access_team(owner, team_id.to_string())
            .await?
    );
    assert!(
        repo.user_can_access_team(member, team_id.to_string())
            .await?
    );
    assert!(
        !repo
            .user_can_access_team(outsider, team_id.to_string())
            .await?
    );
    assert!(
        !repo
            .user_can_access_team(
                user_id("macro|invalid@example.com"),
                "not-a-uuid".to_string()
            )
            .await?
    );

    Ok(())
}

fn upsert_request(
    projection_id: &str,
    target: Target,
    generation_user_id: MacroUserIdStr<'static>,
    requested_at: DateTime<Utc>,
) -> UpsertProjectionInstanceRequest {
    let prompt = "What should I triage first?".to_string();

    UpsertProjectionInstanceRequest {
        cache_key: cache_key(projection_id, target, &prompt, None, None),
        prompt,
        context: None,
        schema: None,
        generation_user_id,
        refresh_cadence: RefreshCadence::High,
        expiry: ProjectionExpiry::Day,
        requested_at,
    }
}

fn cache_key(
    projection_id: &str,
    target: Target,
    prompt: &str,
    context: Option<&str>,
    schema: Option<Value>,
) -> AiProjectionCacheKey {
    AiProjectionCacheKey {
        projection_id: projection_id.to_string(),
        target,
        prompt_hash: prompt_hash(prompt, context, schema.as_ref()),
    }
}

fn schedule_request(
    cache_key: &AiProjectionCacheKey,
    requested_by: MacroUserIdStr<'static>,
    scheduled_at: DateTime<Utc>,
) -> ScheduleProjectionRequest {
    ScheduleProjectionRequest {
        cache_key: cache_key.clone(),
        requested_by,
        reason: ScheduleGenerationReason::ColdStart,
        scheduled_at,
    }
}

async fn insert_user(pool: &Pool<Postgres>, user_id: &MacroUserIdStr<'_>) -> anyhow::Result<()> {
    let email = user_id
        .as_ref()
        .strip_prefix("macro|")
        .unwrap_or_else(|| user_id.as_ref());

    let macro_user_id = Uuid::new_v4();
    let stripe_customer_id = format!("cus_{}", macro_user_id.simple());

    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
        macro_user_id,
        user_id.as_ref(),
        email,
        stripe_customer_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
        user_id.as_ref(),
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_team(
    pool: &Pool<Postgres>,
    team_id: Uuid,
    owner_id: &MacroUserIdStr<'_>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES ($1, 'Projection Team', $2)
        "#,
        team_id,
        owner_id.as_ref(),
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_team_member(
    pool: &Pool<Postgres>,
    team_id: Uuid,
    user_id: &MacroUserIdStr<'_>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team_user (team_id, user_id, team_role)
        VALUES ($1, $2, 'member'::team_role)
        "#,
        team_id,
        user_id.as_ref(),
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn projection_count(pool: &Pool<Postgres>, projection_id: &str) -> anyhow::Result<i64> {
    let row = sqlx::query!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM ai_projection_instances
        WHERE projection_id = $1
        "#,
        projection_id,
    )
    .fetch_one(pool)
    .await?;

    Ok(row.count)
}

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn test_time() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-06-17T16:30:00Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}
