//! Postgres-backed AI projection repository.

#[cfg(test)]
mod test;

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    AiProjectionCacheKey, ClaimProjectionGenerationRequest, ClaimProjectionGenerationResult,
    CompleteProjectionRequest, FailProjectionRequest, ProjectionExpiry, ProjectionInstance,
    ProjectionStatus, RefreshCadence, ReleaseProjectionClaimRequest, ScheduleProjectionRequest,
    Target, UpsertProjectionInstanceRequest,
};
use crate::domain::ports::AiProjectionRepository;

/// Time after which a claimed projection can be reclaimed by another worker.
const STALE_CLAIM_AFTER: Duration = Duration::minutes(15);

/// Delay before retrying a failed generation attempt.
const FAILURE_RETRY_DELAY: Duration = Duration::minutes(15);

/// Postgres implementation of [`AiProjectionRepository`].
#[derive(Clone)]
pub struct PgAIProjectionRepo {
    pool: PgPool,
}

impl PgAIProjectionRepo {
    /// Create a Postgres projection repository backed by the given pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn get_or_create_instance_inner(
        &self,
        request: UpsertProjectionInstanceRequest,
    ) -> Result<ProjectionInstance, sqlx::Error> {
        let id = Uuid::new_v4();
        let target_type = request.cache_key.target.target_type();
        let target_id = request.cache_key.target.id();
        let refresh_cadence = request.refresh_cadence.as_str();
        let expiry = request.expiry.as_str();

        sqlx::query_as!(
            ProjectionInstanceRow,
            r#"
            INSERT INTO ai_projection_instances (
                id,
                projection_id,
                target_type,
                target_id,
                prompt_hash,
                prompt,
                context,
                schema,
                generation_user_id,
                refresh_cadence,
                expiry,
                status,
                next_refresh_at,
                last_requested_at,
                created_at,
                updated_at
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                'cold',
                $12,
                $12,
                $12,
                $12
            )
            ON CONFLICT (projection_id, target_type, target_id, prompt_hash) DO UPDATE
            SET prompt = EXCLUDED.prompt,
                context = EXCLUDED.context,
                schema = EXCLUDED.schema,
                generation_user_id = EXCLUDED.generation_user_id,
                refresh_cadence = EXCLUDED.refresh_cadence,
                expiry = EXCLUDED.expiry,
                last_requested_at = GREATEST(
                    ai_projection_instances.last_requested_at,
                    EXCLUDED.last_requested_at
                ),
                updated_at = EXCLUDED.updated_at
            RETURNING
                id as "id!: Uuid",
                projection_id as "projection_id!: String",
                target_type as "target_type!: String",
                target_id as "target_id!: String",
                prompt_hash as "prompt_hash!: String",
                prompt as "prompt!: String",
                context,
                schema as "schema?: Value",
                generation_user_id as "generation_user_id!: String",
                refresh_cadence as "refresh_cadence!: String",
                expiry as "expiry!: String",
                status as "status!: String",
                output,
                error,
                generated_at as "generated_at?: DateTime<Utc>",
                stale_at as "stale_at?: DateTime<Utc>",
                next_refresh_at as "next_refresh_at!: DateTime<Utc>",
                claimed_at as "claimed_at?: DateTime<Utc>",
                last_requested_at as "last_requested_at!: DateTime<Utc>",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            "#,
            id,
            request.cache_key.projection_id,
            target_type,
            target_id,
            request.cache_key.prompt_hash,
            request.prompt,
            request.context,
            request.schema,
            request.generation_user_id.as_ref(),
            refresh_cadence,
            expiry,
            request.requested_at,
        )
        .try_map(ProjectionInstanceRow::try_into_projection_instance)
        .fetch_one(&self.pool)
        .await
    }

    async fn schedule_generation_inner(
        &self,
        request: ScheduleProjectionRequest,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE ai_projection_instances
            SET generation_user_id = $5,
                status = 'refreshing',
                next_refresh_at = $6,
                updated_at = $6
            WHERE projection_id = $1
              AND target_type = $2
              AND target_id = $3
              AND prompt_hash = $4
              AND (generated_at IS NULL OR generated_at < $6)
            "#,
            request.cache_key.projection_id,
            request.cache_key.target.target_type(),
            request.cache_key.target.id(),
            request.cache_key.prompt_hash,
            request.requested_by.as_ref(),
            request.scheduled_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn user_can_access_team_inner(
        &self,
        user_id: MacroUserIdStr<'static>,
        team_id: String,
    ) -> Result<bool, sqlx::Error> {
        let Ok(team_uuid) = Uuid::parse_str(&team_id) else {
            return Ok(false);
        };

        let can_access = sqlx::query_scalar!(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM team
                WHERE id = $1
                  AND owner_id = $2

                UNION

                SELECT 1
                FROM team_user
                WHERE team_id = $1
                  AND user_id = $2
            ) as "can_access!"
            "#,
            team_uuid,
            user_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(can_access)
    }

    async fn claim_next_due_projection_inner(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Option<ProjectionInstance>, sqlx::Error> {
        let stale_claim_cutoff = now - STALE_CLAIM_AFTER;

        sqlx::query_as!(
            ProjectionInstanceRow,
            r#"
            UPDATE ai_projection_instances
            SET status = 'refreshing',
                claimed_at = $1,
                updated_at = $1
            WHERE id = (
                SELECT id
                FROM ai_projection_instances
                WHERE next_refresh_at <= $1
                  AND (status != 'refreshing' OR claimed_at <= $2)
                  AND (claimed_at IS NULL OR claimed_at <= $2)
                  AND (
                      (expiry = 'day' AND last_requested_at > $1::timestamptz - INTERVAL '1 day')
                      OR (expiry = 'week' AND last_requested_at > $1::timestamptz - INTERVAL '7 days')
                      OR (expiry = 'month' AND last_requested_at > $1::timestamptz - INTERVAL '30 days')
                  )
                ORDER BY next_refresh_at ASC, updated_at ASC, id ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING
                id as "id!: Uuid",
                projection_id as "projection_id!: String",
                target_type as "target_type!: String",
                target_id as "target_id!: String",
                prompt_hash as "prompt_hash!: String",
                prompt as "prompt!: String",
                context,
                schema as "schema?: Value",
                generation_user_id as "generation_user_id!: String",
                refresh_cadence as "refresh_cadence!: String",
                expiry as "expiry!: String",
                status as "status!: String",
                output,
                error,
                generated_at as "generated_at?: DateTime<Utc>",
                stale_at as "stale_at?: DateTime<Utc>",
                next_refresh_at as "next_refresh_at!: DateTime<Utc>",
                claimed_at as "claimed_at?: DateTime<Utc>",
                last_requested_at as "last_requested_at!: DateTime<Utc>",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            "#,
            now,
            stale_claim_cutoff,
        )
        .try_map(ProjectionInstanceRow::try_into_projection_instance)
        .fetch_optional(&self.pool)
        .await
    }

    async fn claim_generation_by_cache_key_inner(
        &self,
        request: ClaimProjectionGenerationRequest,
    ) -> Result<ClaimProjectionGenerationResult, sqlx::Error> {
        let stale_claim_cutoff = request.claimed_at - STALE_CLAIM_AFTER;

        let claimed = sqlx::query_as!(
            ProjectionInstanceRow,
            r#"
            UPDATE ai_projection_instances
            SET status = 'refreshing',
                generation_user_id = $5,
                claimed_at = $6,
                updated_at = $6
            WHERE projection_id = $1
              AND target_type = $2
              AND target_id = $3
              AND prompt_hash = $4
              AND (claimed_at IS NULL OR claimed_at <= $7)
              AND NOT (
                  status = 'ready'
                  AND generated_at IS NOT NULL
                  AND generated_at >= $8
              )
              AND NOT (
                  status = 'error'
                  AND updated_at > $8
              )
              AND (
                  (expiry = 'day' AND last_requested_at > $6::timestamptz - INTERVAL '1 day')
                  OR (expiry = 'week' AND last_requested_at > $6::timestamptz - INTERVAL '7 days')
                  OR (expiry = 'month' AND last_requested_at > $6::timestamptz - INTERVAL '30 days')
              )
            RETURNING
                id as "id!: Uuid",
                projection_id as "projection_id!: String",
                target_type as "target_type!: String",
                target_id as "target_id!: String",
                prompt_hash as "prompt_hash!: String",
                prompt as "prompt!: String",
                context,
                schema as "schema?: Value",
                generation_user_id as "generation_user_id!: String",
                refresh_cadence as "refresh_cadence!: String",
                expiry as "expiry!: String",
                status as "status!: String",
                output,
                error,
                generated_at as "generated_at?: DateTime<Utc>",
                stale_at as "stale_at?: DateTime<Utc>",
                next_refresh_at as "next_refresh_at!: DateTime<Utc>",
                claimed_at as "claimed_at?: DateTime<Utc>",
                last_requested_at as "last_requested_at!: DateTime<Utc>",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            "#,
            request.cache_key.projection_id.as_str(),
            request.cache_key.target.target_type(),
            request.cache_key.target.id(),
            request.cache_key.prompt_hash.as_str(),
            request.generation_user_id.as_ref(),
            request.claimed_at,
            stale_claim_cutoff,
            request.enqueued_at,
        )
        .try_map(ProjectionInstanceRow::try_into_projection_instance)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(instance) = claimed {
            return Ok(ClaimProjectionGenerationResult::Claimed(Box::new(instance)));
        }

        self.classify_unclaimed_generation_message(request, stale_claim_cutoff)
            .await
    }

    async fn classify_unclaimed_generation_message(
        &self,
        request: ClaimProjectionGenerationRequest,
        stale_claim_cutoff: DateTime<Utc>,
    ) -> Result<ClaimProjectionGenerationResult, sqlx::Error> {
        let row = sqlx::query_as!(
            ClaimProjectionStateRow,
            r#"
            SELECT
                expiry as "expiry!: String",
                status as "status!: String",
                generated_at as "generated_at?: DateTime<Utc>",
                claimed_at as "claimed_at?: DateTime<Utc>",
                last_requested_at as "last_requested_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM ai_projection_instances
            WHERE projection_id = $1
              AND target_type = $2
              AND target_id = $3
              AND prompt_hash = $4
            "#,
            request.cache_key.projection_id.as_str(),
            request.cache_key.target.target_type(),
            request.cache_key.target.id(),
            request.cache_key.prompt_hash.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(ClaimProjectionGenerationResult::NotFound);
        };

        if is_expired(&row.expiry, row.last_requested_at, request.claimed_at)? {
            return Ok(ClaimProjectionGenerationResult::Expired);
        }

        if row.is_superseded(request.enqueued_at) {
            return Ok(ClaimProjectionGenerationResult::Superseded);
        }

        if row
            .claimed_at
            .as_ref()
            .is_some_and(|claimed_at| *claimed_at > stale_claim_cutoff)
        {
            return Ok(ClaimProjectionGenerationResult::AlreadyClaimed);
        }

        Ok(ClaimProjectionGenerationResult::AlreadyClaimed)
    }

    async fn release_generation_claim_inner(
        &self,
        request: ReleaseProjectionClaimRequest,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE ai_projection_instances
            SET claimed_at = NULL,
                updated_at = $5
            WHERE projection_id = $1
              AND target_type = $2
              AND target_id = $3
              AND prompt_hash = $4
            "#,
            request.cache_key.projection_id.as_str(),
            request.cache_key.target.target_type(),
            request.cache_key.target.id(),
            request.cache_key.prompt_hash.as_str(),
            request.released_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn complete_generation_inner(
        &self,
        request: CompleteProjectionRequest,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE ai_projection_instances
            SET status = 'ready',
                output = $5,
                error = NULL,
                generated_at = $6,
                stale_at = CASE refresh_cadence
                    WHEN 'high' THEN $6::timestamptz + INTERVAL '1 hour'
                    WHEN 'medium' THEN $6::timestamptz + INTERVAL '6 hours'
                    WHEN 'low' THEN $6::timestamptz + INTERVAL '24 hours'
                    ELSE $6::timestamptz
                END,
                next_refresh_at = CASE refresh_cadence
                    WHEN 'high' THEN $6::timestamptz + INTERVAL '1 hour'
                    WHEN 'medium' THEN $6::timestamptz + INTERVAL '6 hours'
                    WHEN 'low' THEN $6::timestamptz + INTERVAL '24 hours'
                    ELSE $6::timestamptz
                END,
                claimed_at = NULL,
                updated_at = $6
            WHERE projection_id = $1
              AND target_type = $2
              AND target_id = $3
              AND prompt_hash = $4
            "#,
            request.cache_key.projection_id,
            request.cache_key.target.target_type(),
            request.cache_key.target.id(),
            request.cache_key.prompt_hash,
            request.output,
            request.generated_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn fail_generation_inner(
        &self,
        request: FailProjectionRequest,
    ) -> Result<(), sqlx::Error> {
        let retry_at = request.failed_at + FAILURE_RETRY_DELAY;

        sqlx::query!(
            r#"
            UPDATE ai_projection_instances
            SET status = 'error',
                error = $5,
                next_refresh_at = $6,
                claimed_at = NULL,
                updated_at = $7
            WHERE projection_id = $1
              AND target_type = $2
              AND target_id = $3
              AND prompt_hash = $4
            "#,
            request.cache_key.projection_id,
            request.cache_key.target.target_type(),
            request.cache_key.target.id(),
            request.cache_key.prompt_hash,
            request.error,
            retry_at,
            request.failed_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn cleanup_expired_inner(&self, now: DateTime<Utc>) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!(
            r#"
            DELETE FROM ai_projection_instances
            WHERE (expiry = 'day' AND last_requested_at <= $1::timestamptz - INTERVAL '1 day')
               OR (expiry = 'week' AND last_requested_at <= $1::timestamptz - INTERVAL '7 days')
               OR (expiry = 'month' AND last_requested_at <= $1::timestamptz - INTERVAL '30 days')
            "#,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }
}

impl AiProjectionRepository for PgAIProjectionRepo {
    type Err = sqlx::Error;

    fn get_or_create_instance(
        &self,
        request: UpsertProjectionInstanceRequest,
    ) -> impl Future<Output = Result<ProjectionInstance, Self::Err>> + Send {
        self.get_or_create_instance_inner(request)
    }

    fn schedule_generation(
        &self,
        request: ScheduleProjectionRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send {
        self.schedule_generation_inner(request)
    }

    fn user_can_access_team(
        &self,
        user_id: MacroUserIdStr<'static>,
        team_id: String,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send {
        self.user_can_access_team_inner(user_id, team_id)
    }

    fn claim_next_due_projection(
        &self,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<ProjectionInstance>, Self::Err>> + Send {
        self.claim_next_due_projection_inner(now)
    }

    fn claim_generation_by_cache_key(
        &self,
        request: ClaimProjectionGenerationRequest,
    ) -> impl Future<Output = Result<ClaimProjectionGenerationResult, Self::Err>> + Send {
        self.claim_generation_by_cache_key_inner(request)
    }

    fn release_generation_claim(
        &self,
        request: ReleaseProjectionClaimRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send {
        self.release_generation_claim_inner(request)
    }

    fn complete_generation(
        &self,
        request: CompleteProjectionRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send {
        self.complete_generation_inner(request)
    }

    fn fail_generation(
        &self,
        request: FailProjectionRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send {
        self.fail_generation_inner(request)
    }

    fn cleanup_expired(
        &self,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send {
        self.cleanup_expired_inner(now)
    }
}

struct ClaimProjectionStateRow {
    expiry: String,
    status: String,
    generated_at: Option<DateTime<Utc>>,
    claimed_at: Option<DateTime<Utc>>,
    last_requested_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl ClaimProjectionStateRow {
    fn is_superseded(&self, enqueued_at: DateTime<Utc>) -> bool {
        let ready_after_enqueue = self
            .generated_at
            .is_some_and(|generated_at| generated_at >= enqueued_at)
            && self.status == "ready";
        let failed_after_enqueue = self.status == "error" && self.updated_at > enqueued_at;

        ready_after_enqueue || failed_after_enqueue
    }
}

struct ProjectionInstanceRow {
    id: Uuid,
    projection_id: String,
    target_type: String,
    target_id: String,
    prompt_hash: String,
    prompt: String,
    context: Option<String>,
    schema: Option<Value>,
    generation_user_id: String,
    refresh_cadence: String,
    expiry: String,
    status: String,
    output: Option<String>,
    error: Option<String>,
    generated_at: Option<DateTime<Utc>>,
    stale_at: Option<DateTime<Utc>>,
    next_refresh_at: DateTime<Utc>,
    claimed_at: Option<DateTime<Utc>>,
    last_requested_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl ProjectionInstanceRow {
    fn try_into_projection_instance(self) -> Result<ProjectionInstance, sqlx::Error> {
        let target = parse_target(&self.target_type, self.target_id)?;
        let generation_user_id = MacroUserIdStr::try_from(self.generation_user_id)
            .map_err(|error| storage_decode_error("generation_user_id", error))?;

        Ok(ProjectionInstance {
            id: self.id,
            cache_key: AiProjectionCacheKey {
                projection_id: self.projection_id,
                target,
                prompt_hash: self.prompt_hash,
            },
            prompt: self.prompt,
            context: self.context,
            schema: self.schema,
            generation_user_id,
            refresh_cadence: parse_refresh_cadence(&self.refresh_cadence)?,
            expiry: parse_expiry(&self.expiry)?,
            status: parse_status(&self.status)?,
            output: self.output,
            error: self.error,
            generated_at: self.generated_at,
            stale_at: self.stale_at,
            next_refresh_at: self.next_refresh_at,
            claimed_at: self.claimed_at,
            last_requested_at: self.last_requested_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn is_expired(
    expiry: &str,
    last_requested_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    Ok(parse_expiry(expiry)?.expires_at(last_requested_at) <= now)
}

fn parse_target(target_type: &str, target_id: String) -> Result<Target, sqlx::Error> {
    match target_type {
        "user" => Ok(Target::user(target_id)),
        "team" => Ok(Target::team(target_id)),
        value => Err(storage_decode_error(
            "target_type",
            format!("unknown projection target type: {value}"),
        )),
    }
}

fn parse_refresh_cadence(value: &str) -> Result<RefreshCadence, sqlx::Error> {
    match value {
        "high" => Ok(RefreshCadence::High),
        "medium" => Ok(RefreshCadence::Medium),
        "low" => Ok(RefreshCadence::Low),
        value => Err(storage_decode_error(
            "refresh_cadence",
            format!("unknown projection refresh cadence: {value}"),
        )),
    }
}

fn parse_expiry(value: &str) -> Result<ProjectionExpiry, sqlx::Error> {
    match value {
        "day" => Ok(ProjectionExpiry::Day),
        "week" => Ok(ProjectionExpiry::Week),
        "month" => Ok(ProjectionExpiry::Month),
        value => Err(storage_decode_error(
            "expiry",
            format!("unknown projection expiry: {value}"),
        )),
    }
}

fn parse_status(value: &str) -> Result<ProjectionStatus, sqlx::Error> {
    match value {
        "cold" => Ok(ProjectionStatus::Cold),
        "ready" => Ok(ProjectionStatus::Ready),
        "refreshing" => Ok(ProjectionStatus::Refreshing),
        "error" => Ok(ProjectionStatus::Error),
        value => Err(storage_decode_error(
            "status",
            format!("unknown projection status: {value}"),
        )),
    }
}

fn storage_decode_error(index: &str, error: impl std::fmt::Display) -> sqlx::Error {
    sqlx::Error::ColumnDecode {
        index: index.to_string(),
        source: anyhow::anyhow!(error.to_string()).into(),
    }
}
