//! PostgreSQL store with optimistic profile revisions and atomic host reservations.
use crate::domain::{models::*, ports::Repository};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// Scheduling-owned PostgreSQL repository.
pub struct PostgresRepository {
    pool: PgPool,
}
impl PostgresRepository {
    /// Use the application's MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
fn db_error(error: sqlx::Error) -> Error {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation() || e.code().as_deref() == Some("23P01"))
    {
        return Error::Conflict;
    }
    tracing::error!(error = ?error, "scheduling persistence failed");
    Error::Unavailable
}
fn decode<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, Error> {
    serde_json::from_value(value).map_err(|_| Error::Unavailable)
}
fn encode<T: serde::Serialize>(value: &T) -> Result<serde_json::Value, Error> {
    serde_json::to_value(value).map_err(|_| Error::Unavailable)
}
fn status(value: BookingStatus) -> &'static str {
    match value {
        BookingStatus::Pending => "pending",
        BookingStatus::Processing => "processing",
        BookingStatus::Confirmed => "confirmed",
        BookingStatus::Cancelled => "cancelled",
        BookingStatus::Failed => "failed",
    }
}
impl Repository for PostgresRepository {
    async fn consume_budget(&self, profile: Uuid, budget: PublicBudget) -> Result<(), Error> {
        let (key, seconds, limit) = match budget {
            PublicBudget::Availability => ("availability", 60.0_f64, 120_i32),
            PublicBudget::Booking => ("booking", 3600.0_f64, 30_i32),
        };
        let allowed = sqlx::query_scalar!(r#"
            INSERT INTO scheduling_public_budget (profile_id, kind, window_start, used)
            VALUES ($1, $2, now(), 1)
            ON CONFLICT (profile_id, kind) DO UPDATE SET
                window_start = CASE WHEN scheduling_public_budget.window_start <= now() - make_interval(secs => $3) THEN now() ELSE scheduling_public_budget.window_start END,
                used = CASE WHEN scheduling_public_budget.window_start <= now() - make_interval(secs => $3) THEN 1 ELSE scheduling_public_budget.used + 1 END
            WHERE scheduling_public_budget.window_start <= now() - make_interval(secs => $3) OR scheduling_public_budget.used < $4
            RETURNING used
        "#, profile, key, seconds, limit).fetch_optional(&self.pool).await.map_err(db_error)?;
        allowed.map(|_| ()).ok_or(Error::RateLimited)
    }
    async fn claim_recovery(&self) -> Result<Option<BookingRecord>, Error> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let row = sqlx::query_scalar!("SELECT record FROM scheduling_booking WHERE status IN ('processing', 'failed') AND recovery_at <= now() ORDER BY recovery_at, id FOR UPDATE SKIP LOCKED LIMIT 1")
            .fetch_optional(&mut *tx).await.map_err(db_error)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let mut record: BookingRecord = decode(row)?;
        let operation = record.operation.as_mut().ok_or(Error::Unavailable)?;
        operation.attempt = operation.attempt.saturating_add(1);
        record.revision = record.revision.saturating_add(1);
        operation.retry_at = Utc::now() + chrono::Duration::minutes(5);
        let retry_at = operation.retry_at;
        record.booking.status = BookingStatus::Processing;
        let json = encode(&record)?;
        sqlx::query!("UPDATE scheduling_booking SET status = 'processing', record = $2, recovery_at = $3 WHERE id = $1", record.booking.id, json, retry_at)
            .execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(Some(record))
    }
    async fn profile(&self, id: Uuid) -> Result<Option<OwnedProfile>, Error> {
        let row = sqlx::query!("SELECT user_id, team_id, revision, configuration FROM scheduling_profile WHERE id = $1", id).fetch_optional(&self.pool).await.map_err(db_error)?;
        row.map(|r| {
            let mut profile: Profile = decode(r.configuration)?;
            profile.revision = r.revision;
            Ok(OwnedProfile {
                user_id: r.user_id,
                team_id: r.team_id,
                profile,
            })
        })
        .transpose()
    }
    async fn save_profile(&self, owner: OwnedProfile) -> Result<Profile, Error> {
        let mut profile = owner.profile;
        let json = encode(&profile)?;
        let revision = if profile.revision == 0 {
            sqlx::query_scalar!("INSERT INTO scheduling_profile (id, user_id, team_id, configuration) VALUES ($1, $2, $3, $4) RETURNING revision", profile.id, owner.user_id, owner.team_id, json).fetch_one(&self.pool).await.map_err(db_error)?
        } else {
            sqlx::query_scalar!("UPDATE scheduling_profile SET configuration = $2, revision = revision + 1 WHERE id = $1 AND revision = $3 RETURNING revision", profile.id, json, profile.revision).fetch_optional(&self.pool).await.map_err(db_error)?.ok_or(Error::Conflict)?
        };
        profile.revision = revision;
        Ok(profile)
    }
    async fn bookings(
        &self,
        profile: Uuid,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<BookingRecord>, Error> {
        let records = sqlx::query_scalar!("SELECT record FROM scheduling_booking WHERE profile_id = $1 AND starts_at >= $2 AND starts_at < $3 ORDER BY starts_at, id LIMIT 5001", profile, start, end).fetch_all(&self.pool).await.map_err(db_error)?;
        if records.len() > 5000 {
            return Err(Error::Invalid(
                "Too many bookings in this date range. Choose a shorter date range.".into(),
            ));
        }
        records.into_iter().map(decode).collect()
    }
    async fn busy(
        &self,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        Ok(sqlx::query!(r#"SELECT user_id, lower(piece) AS "start!", upper(piece) AS "end!" FROM scheduling_host_claim CROSS JOIN LATERAL unnest(occupied) AS piece WHERE user_id = ANY($1) AND piece && tstzrange($2, $3, '[)') AND ($4::uuid IS NULL OR booking_id <> $4)"#, hosts, start, end, exclude).fetch_all(&self.pool).await.map_err(db_error)?.into_iter().map(|r| BusyRange { host: r.user_id, start: r.start, end: r.end }).collect())
    }
    async fn reserve(
        &self,
        record: BookingRecord,
        limit: Option<u16>,
        day_start: DateTime<Utc>,
        day_end: DateTime<Utc>,
    ) -> Result<BookingRecord, Error> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        // Serialize per-profile limits; the exclusion constraint also protects hosts across profiles.
        sqlx::query!(
            "SELECT id FROM scheduling_profile WHERE id = $1 FOR UPDATE",
            record.profile_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        if let Some(existing) = sqlx::query_scalar!(
            "SELECT record FROM scheduling_booking WHERE request_id = $1",
            record.request_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?
        {
            let existing: BookingRecord = decode(existing)?;
            if existing.profile_id == record.profile_id
                && existing.booking.email == record.booking.email
                && existing.booking.starts_at == record.booking.starts_at
                && existing.booking.event_type_id == record.booking.event_type_id
            {
                return Ok(existing);
            }
            return Err(Error::Conflict);
        }
        if let Some(limit) = limit {
            let count = sqlx::query_scalar!("SELECT count(*) FROM scheduling_booking WHERE profile_id = $1 AND event_type_id = $2 AND starts_at >= $3 AND starts_at < $4 AND status <> 'cancelled'", record.profile_id, record.booking.event_type_id, day_start, day_end).fetch_one(&mut *tx).await.map_err(db_error)?.unwrap_or(0);
            if count >= i64::from(limit) {
                return Err(Error::Conflict);
            }
        }
        let json = encode(&record)?;
        sqlx::query!("INSERT INTO scheduling_booking (id, profile_id, request_id, event_type_id, starts_at, ends_at, status, record, recovery_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", record.booking.id, record.profile_id, record.request_id, record.booking.event_type_id, record.booking.starts_at, record.booking.ends_at, status(record.booking.status), json, record.operation.as_ref().map(|o| o.retry_at)).execute(&mut *tx).await.map_err(db_error)?;
        for host in &record.booking.hosts {
            sqlx::query!("INSERT INTO scheduling_host_claim (booking_id, user_id, occupied) VALUES ($1,$2,tstzmultirange(tstzrange($3,$4,'[)')))", record.booking.id, host, record.busy_start, record.busy_end).execute(&mut *tx).await.map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)?;
        Ok(record)
    }
    async fn booking(&self, id: Uuid) -> Result<Option<BookingRecord>, Error> {
        sqlx::query_scalar!("SELECT record FROM scheduling_booking WHERE id = $1", id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_error)?
            .map(decode)
            .transpose()
    }
    async fn booking_request(&self, request: Uuid) -> Result<Option<BookingRecord>, Error> {
        sqlx::query_scalar!(
            "SELECT record FROM scheduling_booking WHERE request_id = $1",
            request
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db_error)?
        .map(decode)
        .transpose()
    }
    async fn move_booking(
        &self,
        mut record: BookingRecord,
        expected: BookingStatus,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<BookingRecord, Error> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        sqlx::query!(
            "SELECT id FROM scheduling_profile WHERE id = $1 FOR UPDATE",
            record.profile_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        if let Some(limit) = record.event.daily_limit {
            let count = sqlx::query_scalar!("SELECT count(*) FROM scheduling_booking WHERE profile_id = $1 AND event_type_id = $2 AND starts_at >= $3 AND starts_at < $4 AND status <> 'cancelled' AND id <> $5", record.profile_id, record.booking.event_type_id, start, end, record.booking.id).fetch_one(&mut *tx).await.map_err(db_error)?.unwrap_or(0);
            if count >= i64::from(limit) {
                return Err(Error::Conflict);
            }
        }
        let expected_revision = record.revision.to_string();
        record.revision = record.revision.saturating_add(1);
        let json = encode(&record)?;
        let updated = sqlx::query!("UPDATE scheduling_booking SET starts_at = $2, ends_at = $3, status = 'processing', record = $4, recovery_at = $6 WHERE id = $1 AND status = $5 AND COALESCE(record->>'revision', '0') = $7", record.booking.id, record.booking.starts_at, record.booking.ends_at, json, status(expected), record.operation.as_ref().map(|o| o.retry_at), expected_revision).execute(&mut *tx).await.map_err(db_error)?;
        if updated.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        sqlx::query!("UPDATE scheduling_host_claim SET occupied = occupied + tstzmultirange(tstzrange($2,$3,'[)')) WHERE booking_id = $1", record.booking.id, record.busy_start, record.busy_end).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(record)
    }
    async fn update_booking(
        &self,
        mut record: BookingRecord,
        expected: BookingStatus,
    ) -> Result<BookingRecord, Error> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let expected_revision = record.revision.to_string();
        record.revision = record.revision.saturating_add(1);
        let json = encode(&record)?;
        let updated = sqlx::query!(
            "UPDATE scheduling_booking SET status = $2, record = $3, recovery_at = $5 WHERE id = $1 AND status = $4 AND COALESCE(record->>'revision', '0') = $8 AND ($4 <> 'processing' OR (record->'operation'->>'id' IS NOT DISTINCT FROM $6 AND record->'operation'->>'attempt' IS NOT DISTINCT FROM $7))",
            record.booking.id,
            status(record.booking.status),
            json,
            status(expected),
            if matches!(record.booking.status, BookingStatus::Processing | BookingStatus::Failed) { record.operation.as_ref().map(|o| o.retry_at) } else { None },
            record.operation.as_ref().map(|o| o.id.to_string()),
            record.operation.as_ref().map(|o| o.attempt.to_string()),
            expected_revision
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        if updated.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        if record.booking.status == BookingStatus::Cancelled {
            sqlx::query!(
                "DELETE FROM scheduling_host_claim WHERE booking_id = $1",
                record.booking.id
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        if matches!(
            record.booking.status,
            BookingStatus::Confirmed | BookingStatus::Pending
        ) {
            sqlx::query!("UPDATE scheduling_host_claim SET occupied = tstzmultirange(tstzrange($2,$3,'[)')) WHERE booking_id = $1", record.booking.id, record.busy_start, record.busy_end).execute(&mut *tx).await.map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)?;
        Ok(record)
    }
}

#[cfg(test)]
mod test;
