//! PostgreSQL implementation of the [`SystemStatusRepo`] port.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{StatusMessage, StatusUpdate, SystemStatus};
use crate::domain::ports::SystemStatusRepo;

const OPERATIONAL: &str = "operational";
const DEGRADED: &str = "degraded";
const MAJOR_OUTAGE: &str = "major_outage";

/// Postgres-backed system status repository.
#[derive(Debug, Clone)]
pub struct PgSystemStatusRepo {
    pool: PgPool,
}

impl PgSystemStatusRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres system status repository.
#[derive(Debug, thiserror::Error)]
pub enum PgSystemStatusRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored row does not form a valid status update.
    #[error("invalid system status row {0}")]
    InvalidRow(Uuid),
}

struct StatusUpdateRow {
    id: Uuid,
    status: String,
    message: Option<String>,
    user_id: String,
    created_at: DateTime<Utc>,
}

impl TryFrom<StatusUpdateRow> for StatusUpdate {
    type Error = PgSystemStatusRepoErr;

    fn try_from(row: StatusUpdateRow) -> Result<Self, Self::Error> {
        let invalid = || PgSystemStatusRepoErr::InvalidRow(row.id);
        let message = row.message.map(StatusMessage::try_from).transpose();
        let status = match (row.status.as_str(), message) {
            (OPERATIONAL, Ok(None)) => SystemStatus::Operational,
            (DEGRADED, Ok(Some(message))) => SystemStatus::Degraded { message },
            (MAJOR_OUTAGE, Ok(Some(message))) => SystemStatus::MajorOutage { message },
            _ => return Err(invalid()),
        };
        Ok(Self {
            id: row.id,
            status,
            user_id: MacroUserIdStr::try_from(row.user_id).map_err(|_| invalid())?,
            created_at: row.created_at,
        })
    }
}

fn status_column(status: &SystemStatus) -> &'static str {
    match status {
        SystemStatus::Operational => OPERATIONAL,
        SystemStatus::Degraded { .. } => DEGRADED,
        SystemStatus::MajorOutage { .. } => MAJOR_OUTAGE,
    }
}

impl SystemStatusRepo for PgSystemStatusRepo {
    type Err = PgSystemStatusRepoErr;

    #[tracing::instrument(err, skip_all, fields(status_update.id = %update.id))]
    async fn insert_update(&self, update: &StatusUpdate) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO system_status (id, status, message, user_id, created_at)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            update.id,
            status_column(&update.status),
            update.status.message().map(StatusMessage::as_str),
            update.user_id.as_ref(),
            update.created_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip_all)]
    async fn latest_update(&self) -> Result<Option<StatusUpdate>, Self::Err> {
        sqlx::query_as!(
            StatusUpdateRow,
            r#"
            SELECT id, status, message, user_id, created_at
            FROM system_status
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(StatusUpdate::try_from)
        .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    async fn list_updates(&self, limit: u16) -> Result<Vec<StatusUpdate>, Self::Err> {
        sqlx::query_as!(
            StatusUpdateRow,
            r#"
            SELECT id, status, message, user_id, created_at
            FROM system_status
            ORDER BY created_at DESC, id DESC
            LIMIT $1
            "#,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(StatusUpdate::try_from)
        .collect()
    }
}
