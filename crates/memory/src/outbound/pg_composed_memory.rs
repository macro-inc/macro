//! Transactional storage for composed memory. Legacy rows are never shared.
use super::pg_memory_repo::PgMemoryRepo;
use crate::domain::{models::*, ports::*};
use chrono::NaiveDate;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

impl ComposedMemoryRepo for PgMemoryRepo {
    #[tracing::instrument(skip_all, err)]
    async fn enroll(&self, user: &MacroUserIdStr<'_>) -> Result<()> {
        sqlx::query!(
            "INSERT INTO memory_refresh_job (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
            user.as_ref()
        )
        .execute(&self.inner)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn claim_refresh(&self, yesterday: NaiveDate) -> Result<Option<RefreshClaim>> {
        let token = macro_uuid::generate_uuid_v7();
        let row = sqlx::query!(r#"
            WITH due AS (
                SELECT j.user_id, COALESCE(p.through_date + 1, (j.created_at AT TIME ZONE 'UTC')::date - 1) AS day
                FROM memory_refresh_job j LEFT JOIN memory_profile p ON p.user_id = j.user_id
                WHERE j.lease_until < NOW() AND (p.through_date IS NULL OR p.through_date < $1)
                ORDER BY j.lease_until, j.user_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
            )
            UPDATE memory_refresh_job j SET lease_token = $2, lease_until = NOW() + INTERVAL '25 minutes'
            FROM due WHERE j.user_id = due.user_id RETURNING j.user_id, due.day AS "day!"
        "#, yesterday, token).fetch_optional(&self.inner).await?;
        row.map(|r| {
            Ok(RefreshClaim {
                user: MacroUserIdStr::try_from(r.user_id)
                    .map_err(|e| MemoryError::Other(e.into()))?,
                date: r.day,
                token,
            })
        })
        .transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn release_refresh(&self, claim: &RefreshClaim) -> Result<()> {
        sqlx::query!("UPDATE memory_refresh_job SET lease_token = NULL, lease_until = NOW() WHERE user_id = $1 AND lease_token = $2", claim.user.as_ref(), claim.token)
            .execute(&self.inner).await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn latest_activity(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<Activity>> {
        Ok(sqlx::query_as!(Activity, r#"
            SELECT DISTINCT ON (granularity) granularity AS "granularity: Granularity", period_start, period_end, content
            FROM memory_activity WHERE user_id = $1 ORDER BY granularity, period_start DESC
        "#, user.as_ref()).fetch_all(&self.inner).await?)
    }

    #[tracing::instrument(skip_all, err)]
    async fn explicit(&self, user: &MacroUserIdStr<'_>) -> Result<ExplicitMemory> {
        Ok(sqlx::query_as!(
            ExplicitMemory,
            "SELECT content, revision FROM memory_explicit WHERE user_id = $1",
            user.as_ref()
        )
        .fetch_optional(&self.inner)
        .await?
        .unwrap_or_default())
    }

    #[tracing::instrument(skip_all, err)]
    async fn save_explicit(
        &self,
        user: &MacroUserIdStr<'_>,
        expected: i64,
        content: &str,
    ) -> Result<ExplicitMemory> {
        let mut tx = self.inner.begin().await?;
        sqlx::query!(
            "INSERT INTO memory_explicit (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
            user.as_ref()
        )
        .execute(&mut *tx)
        .await?;
        let saved = sqlx::query_as!(
            ExplicitMemory,
            r#"
            UPDATE memory_explicit SET content = $2, revision = revision + 1, updated_at = NOW()
            WHERE user_id = $1 AND revision = $3 RETURNING content, revision
        "#,
            user.as_ref(),
            content,
            expected
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(MemoryError::Conflict)?;
        tx.commit().await?;
        Ok(saved)
    }

    #[tracing::instrument(skip_all, err)]
    async fn snapshot(
        &self,
        user: &MacroUserIdStr<'_>,
        since: NaiveDate,
    ) -> Result<MemorySnapshot> {
        let mut tx = self.inner.begin().await?;
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await?;
        let profile = sqlx::query!(
            "SELECT revision, through_date, content FROM memory_profile WHERE user_id = $1",
            user.as_ref()
        )
        .fetch_optional(&mut *tx)
        .await?;
        let first_date = sqlx::query_scalar!(
            "SELECT (created_at AT TIME ZONE 'UTC')::date - 1 AS \"first_date!\" FROM memory_refresh_job WHERE user_id = $1",
            user.as_ref()
        ).fetch_optional(&mut *tx).await?;
        let rows = sqlx::query_as!(Activity, r#"
            SELECT granularity AS "granularity: Granularity", period_start, period_end, content
            FROM memory_activity WHERE user_id = $1 AND (period_end >= $2 OR granularity = 'summary')
            ORDER BY period_start, granularity
        "#, user.as_ref(), since).fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(MemorySnapshot {
            first_date,
            revision: profile.as_ref().map_or(0, |p| p.revision),
            through_date: profile.as_ref().map(|p| p.through_date),
            profile: profile.map_or_else(String::new, |p| p.content),
            activity: rows,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn save_generation(
        &self,
        user: &MacroUserIdStr<'_>,
        expected: i64,
        date: NaiveDate,
        profile: &str,
        activity: &[Activity],
        teams: &[Uuid],
    ) -> Result<()> {
        let mut tx = self.inner.begin().await?;
        // Insert only for the initial revision; updates compare the snapshot revision.
        // The row lock serializes the whole bundle. Failure rolls back all components.
        sqlx::query!("INSERT INTO memory_profile (user_id, content, through_date, revision) VALUES ($1, '', $2, 0) ON CONFLICT DO NOTHING", user.as_ref(), date)
            .execute(&mut *tx).await?;
        let updated = sqlx::query!(
            r#"
            UPDATE memory_profile SET content = $3, through_date = $4,
                revision = revision + 1, updated_at = NOW()
            WHERE user_id = $1 AND revision = $2
        "#,
            user.as_ref(),
            expected,
            profile,
            date
        )
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(MemoryError::Conflict);
        }
        for row in activity {
            let kind = row.granularity.as_ref();
            sqlx::query!(r#"
                INSERT INTO memory_activity (user_id, granularity, period_start, period_end, content)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id, granularity, period_start) DO UPDATE
                SET content = EXCLUDED.content, period_end = EXCLUDED.period_end, updated_at = NOW()
                WHERE memory_activity.granularity <> 'day'
            "#, user.as_ref(), kind, row.period_start, row.period_end, row.content).execute(&mut *tx).await?;
            sqlx::query!(
                r#"
                INSERT INTO memory_activity_team (user_id, granularity, period_start, team_id)
                SELECT $1, $2, $3, UNNEST($4::uuid[]) ON CONFLICT DO NOTHING
            "#,
                user.as_ref(),
                kind,
                row.period_start,
                teams
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn profiles(&self, users: &[String]) -> Result<Vec<(String, String)>> {
        Ok(sqlx::query!(
            "SELECT user_id, content FROM memory_profile WHERE user_id = ANY($1) ORDER BY user_id",
            users
        )
        .fetch_all(&self.inner)
        .await?
        .into_iter()
        .map(|r| (r.user_id, r.content))
        .collect())
    }

    #[tracing::instrument(skip_all, err)]
    async fn activity(
        &self,
        user: &MacroUserIdStr<'_>,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<Activity>> {
        Ok(sqlx::query_as!(
            Activity,
            r#"
            SELECT granularity AS "granularity: Granularity", period_start, period_end, content
            FROM memory_activity WHERE user_id = $1 AND period_start <= $3 AND period_end >= $2
            ORDER BY period_start, granularity LIMIT 1500
        "#,
            user.as_ref(),
            start,
            end
        )
        .fetch_all(&self.inner)
        .await?)
    }
}

impl sqlx::Type<sqlx::Postgres> for Granularity {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::Type<sqlx::Postgres>>::type_info()
    }
}
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for Granularity {
    fn decode(
        value: sqlx::postgres::PgValueRef<'r>,
    ) -> std::result::Result<Self, sqlx::error::BoxDynError> {
        let value = <&str as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(value.parse()?)
    }
}
