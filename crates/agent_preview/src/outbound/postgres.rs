//! Preview-specific shared state; the session management rows remain untouched.
use crate::domain::{PreviewError, PreviewId, PreviewStatus, storage::*};
use agent_fold::domain::log::AgentSessionId;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, types::Json};
use std::net::SocketAddr;
use uuid::Uuid;

/// Postgres ownership registry and hash-only credential store.
#[derive(Clone)]
pub struct PgPreviewRepository {
    pool: PgPool,
}
impl PgPreviewRepository {
    /// Use the host's existing MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
fn unavailable(error: sqlx::Error) -> PreviewError {
    tracing::warn!(?error, "preview repository failed");
    PreviewError::Unavailable
}
fn timestamp(ms: i64) -> Result<DateTime<Utc>, PreviewError> {
    DateTime::from_timestamp_millis(ms).ok_or(PreviewError::Invalid)
}
fn status(value: PreviewStatus) -> &'static str {
    match value {
        PreviewStatus::Starting => "starting",
        PreviewStatus::Ready => "ready",
        PreviewStatus::Offline => "offline",
        PreviewStatus::Expired => "expired",
        PreviewStatus::Stopped => "stopped",
    }
}
fn record(
    mut metadata: StoredPreview,
    replica: Option<Uuid>,
    state: &str,
) -> Result<StoredPreview, PreviewError> {
    metadata.replica = replica;
    metadata.preview.status = match state {
        "starting" => PreviewStatus::Starting,
        "ready" => PreviewStatus::Ready,
        "offline" => PreviewStatus::Offline,
        "expired" => PreviewStatus::Expired,
        "stopped" => PreviewStatus::Stopped,
        _ => return Err(PreviewError::Unavailable),
    };
    Ok(metadata)
}
#[async_trait]
impl PreviewRepository for PgPreviewRepository {
    #[tracing::instrument(skip_all, fields(session_id = %preview.preview.agent_session_id), err)]
    async fn create(
        &self,
        preview: StoredPreview,
        ssh: StoredCredential,
        limits: CreationLimits,
    ) -> Result<(), PreviewError> {
        let mut tx = self.pool.begin().await.map_err(unavailable)?;
        // Serialize quota checks and replacement across replicas, including when
        // there is no previous preview row to lock. This table is bounded (1000).
        sqlx::query!("LOCK TABLE agent_preview_lease IN EXCLUSIVE MODE")
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        let session = preview.preview.agent_session_id.as_uuid();
        let user: &str = preview.user.as_ref();
        let budget = sqlx::query!(
            r#"SELECT count(*) FILTER (WHERE session_id <> $2) AS "total!",
               count(*) FILTER (WHERE user_id = $1 AND status IN ('starting', 'ready') AND session_id <> $2) AS "account!",
               EXISTS (SELECT 1 FROM agent_preview_lease WHERE user_id = $1 AND created_at > now() - make_interval(secs => $3)) AS "paced!"
               FROM agent_preview_lease WHERE expires_at > now()"#, user, session, limits.pace_seconds
        ).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if budget.total >= limits.total || budget.account >= limits.account || budget.paced {
            return Err(PreviewError::Limited);
        }
        sqlx::query!(
            "DELETE FROM agent_preview_lease WHERE session_id = $1",
            session
        )
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
        let id = preview.preview.id.to_string();
        let expires = timestamp(preview.preview.expires_at as i64)?;
        sqlx::query!(
            "INSERT INTO agent_preview_lease (id, session_id, user_id, metadata, status, expires_at) VALUES ($1, $2, $3, $4, 'starting', $5)",
            id, session, user, Json(&preview) as _, expires
        ).execute(&mut *tx).await.map_err(unavailable)?;
        let token_expiry = timestamp(ssh.expires)?;
        sqlx::query!(
            "INSERT INTO agent_preview_credential (hash, kind, preview_id, expires_at) VALUES ($1, 'ssh', $2, $3)",
            ssh.hash.as_slice(), id, token_expiry
        ).execute(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)
    }
    #[tracing::instrument(skip_all, fields(session_id = %session), err)]
    async fn session(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<StoredPreview>, PreviewError> {
        let row = sqlx::query!(
            r#"SELECT metadata AS "metadata: Json<StoredPreview>", replica_id,
               CASE WHEN l.expires_at <= now() THEN 'expired'
                    WHEN l.replica_id IS NOT NULL AND NOT EXISTS
                      (SELECT 1 FROM agent_preview_replica r WHERE r.id = l.replica_id AND r.expires_at > now()) AND l.status IN ('starting','ready')
                    THEN 'offline' ELSE status END AS "state!"
               FROM agent_preview_lease l WHERE session_id = $1"#, session.as_uuid()
        ).fetch_optional(&self.pool).await.map_err(unavailable)?;
        row.map(|r| record(r.metadata.0, r.replica_id, &r.state))
            .transpose()
    }
    #[tracing::instrument(skip_all, fields(preview_id = %id), err)]
    async fn preview(&self, id: &PreviewId) -> Result<StoredPreview, PreviewError> {
        let row = sqlx::query!(
            r#"SELECT metadata AS "metadata: Json<StoredPreview>", replica_id, status
               FROM agent_preview_lease l WHERE id = $1 AND expires_at > now()
               AND status IN ('starting','ready') AND (replica_id IS NULL OR EXISTS
               (SELECT 1 FROM agent_preview_replica r WHERE r.id = l.replica_id AND r.expires_at > now()))"#, id.to_string()
        ).fetch_optional(&self.pool).await.map_err(unavailable)?.ok_or(PreviewError::Offline)?;
        record(row.metadata.0, row.replica_id, &row.status)
    }
    #[tracing::instrument(skip_all, fields(%replica), err)]
    async fn claim(&self, hash: [u8; 32], replica: Uuid) -> Result<StoredPreview, PreviewError> {
        let row = sqlx::query!(
            r#"WITH credential AS (
                DELETE FROM agent_preview_credential WHERE hash = $1 AND kind = 'ssh' AND expires_at > now()
                RETURNING preview_id
            ) UPDATE agent_preview_lease l SET replica_id = $2 FROM credential c
              WHERE l.id = c.preview_id AND l.replica_id IS NULL AND l.status = 'starting'
              AND l.expires_at > now() AND EXISTS (SELECT 1 FROM agent_preview_replica WHERE id = $2 AND expires_at > now())
              RETURNING l.metadata AS "metadata: Json<StoredPreview>", l.status"#,
            hash.as_slice(), replica
        ).fetch_optional(&self.pool).await.map_err(unavailable)?.ok_or(PreviewError::Denied)?;
        record(row.metadata.0, Some(replica), &row.status)
    }
    #[tracing::instrument(skip_all, fields(preview_id = %id, %replica), err)]
    async fn status(
        &self,
        id: &PreviewId,
        replica: Uuid,
        next: PreviewStatus,
    ) -> Result<bool, PreviewError> {
        let updated = sqlx::query!(
            "UPDATE agent_preview_lease l SET status = $3 WHERE id = $1 AND replica_id = $2 AND status IN ('starting','ready') AND expires_at > now() AND EXISTS (SELECT 1 FROM agent_preview_replica WHERE id = $2 AND expires_at > now())",
            id.to_string(), replica, status(next)
        ).execute(&self.pool).await.map_err(unavailable)?;
        Ok(updated.rows_affected() == 1)
    }
    async fn stop(&self, session: AgentSessionId) -> Result<Option<StoredPreview>, PreviewError> {
        let row = sqlx::query!(
            r#"UPDATE agent_preview_lease SET status = 'stopped' WHERE session_id = $1
               RETURNING metadata AS "metadata: Json<StoredPreview>", replica_id, status"#,
            session.as_uuid()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(unavailable)?;
        row.map(|r| record(r.metadata.0, r.replica_id, &r.status))
            .transpose()
    }
    #[tracing::instrument(skip_all, fields(preview_id = %credential.preview), err)]
    async fn credential(
        &self,
        kind: CredentialKind,
        credential: StoredCredential,
        limit: i64,
    ) -> Result<(), PreviewError> {
        let user = credential.user.as_ref().map(|u| u.as_ref());
        let expires = timestamp(credential.expires)?;
        let mut tx = self.pool.begin().await.map_err(unavailable)?;
        // Credential creation is infrequent; the same lock order as create()
        // serializes global bounds and prevents stop/re-share racing issuance.
        sqlx::query!("LOCK TABLE agent_preview_lease IN EXCLUSIVE MODE")
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        let inserted = sqlx::query!(
            r#"INSERT INTO agent_preview_credential (hash, kind, preview_id, user_id, expires_at)
               SELECT $1, $2, id, $4, LEAST($5, expires_at) FROM agent_preview_lease l
               WHERE id = $3 AND status = 'ready' AND expires_at > now()
               AND EXISTS (SELECT 1 FROM agent_preview_replica r WHERE r.id = l.replica_id AND r.expires_at > now())
               AND (SELECT count(*) FROM agent_preview_credential WHERE kind = $2 AND expires_at > now()) < $6"#,
            credential.hash.as_slice(), kind.as_str(), credential.preview.to_string(), user, expires,
            limit
        ).execute(&mut *tx).await.map_err(unavailable)?;
        if inserted.rows_affected() == 0 {
            let live = sqlx::query_scalar!(
                r#"SELECT EXISTS (SELECT 1 FROM agent_preview_lease l
                   WHERE id = $1 AND status = 'ready' AND expires_at > now()
                   AND EXISTS (SELECT 1 FROM agent_preview_replica r WHERE r.id = l.replica_id AND r.expires_at > now())) AS "live!""#,
                credential.preview.to_string()
            ).fetch_one(&mut *tx).await.map_err(unavailable)?;
            return Err(if live {
                PreviewError::Limited
            } else {
                PreviewError::Offline
            });
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(())
    }
    #[tracing::instrument(skip_all, fields(preview_id = %id), err)]
    async fn authenticate(
        &self,
        kind: CredentialKind,
        id: &PreviewId,
        hash: [u8; 32],
        consume: bool,
    ) -> Result<StoredCredential, PreviewError> {
        // Atomic DELETE consumes a ticket once. Reusable cookies take no row
        // lock, so one browser's Vite module fan-out can authenticate concurrently.
        let row = if consume {
            sqlx::query!(
                "DELETE FROM agent_preview_credential WHERE hash = $1 AND preview_id = $2 AND kind = $3 AND expires_at > now() RETURNING user_id, expires_at",
                hash.as_slice(), id.to_string(), kind.as_str()
            ).fetch_optional(&self.pool).await.map_err(unavailable)?.map(|r| (r.user_id, r.expires_at))
        } else {
            sqlx::query!(
                "SELECT user_id, expires_at FROM agent_preview_credential WHERE hash = $1 AND preview_id = $2 AND kind = $3 AND expires_at > now()",
                hash.as_slice(), id.to_string(), kind.as_str()
            ).fetch_optional(&self.pool).await.map_err(unavailable)?.map(|r| (r.user_id, r.expires_at))
        }.ok_or(PreviewError::Denied)?;
        Ok(StoredCredential {
            hash,
            preview: id.clone(),
            user: row
                .0
                .map(MacroUserIdStr::try_from)
                .transpose()
                .map_err(|_| PreviewError::Unavailable)?,
            expires: row.1.timestamp_millis(),
        })
    }
    #[tracing::instrument(skip_all, fields(%replica), err)]
    async fn heartbeat(
        &self,
        replica: Uuid,
        address: SocketAddr,
        ttl_seconds: f64,
    ) -> Result<Vec<crate::domain::Preview>, PreviewError> {
        let mut tx = self.pool.begin().await.map_err(unavailable)?;
        // Invalidate old transports before refreshing a heartbeat after a pause.
        // The same process may resume, but its expired claims never become live again.
        let transitions = sqlx::query!(
            r#"UPDATE agent_preview_lease SET status = 'offline' WHERE replica_id = $1 AND status IN ('starting','ready') AND EXISTS (SELECT 1 FROM agent_preview_replica WHERE id = $1 AND expires_at <= now()) RETURNING metadata AS "metadata: Json<StoredPreview>", replica_id, status"#, replica
        ).fetch_all(&mut *tx).await.map_err(unavailable)?;
        sqlx::query!(
            "INSERT INTO agent_preview_replica (id, address, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3)) ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at",
            replica, address.to_string(), ttl_seconds
        ).execute(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        transitions
            .into_iter()
            .map(|r| record(r.metadata.0, r.replica_id, &r.status).map(|p| p.preview))
            .collect()
    }
    async fn destination(&self, id: &PreviewId) -> Result<(Uuid, SocketAddr), PreviewError> {
        let row = sqlx::query!(
            "SELECT r.id, r.address FROM agent_preview_replica r JOIN agent_preview_lease l ON l.replica_id = r.id WHERE l.id = $1 AND l.status IN ('starting','ready') AND l.expires_at > now() AND r.expires_at > now()", id.to_string()
        ).fetch_optional(&self.pool).await.map_err(unavailable)?.ok_or(PreviewError::Offline)?;
        Ok((
            row.id,
            row.address.parse().map_err(|_| PreviewError::Unavailable)?,
        ))
    }
    async fn watch(
        &self,
        session: AgentSessionId,
        user: &MacroUserIdStr<'_>,
        limits: WatchLimits,
    ) -> Result<(), PreviewError> {
        let expires = timestamp(limits.expires)?;
        let mut tx = self.pool.begin().await.map_err(unavailable)?;
        sqlx::query!("LOCK TABLE agent_preview_watcher IN EXCLUSIVE MODE")
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        sqlx::query!(
            r#"INSERT INTO agent_preview_watcher (session_id, user_id, expires_at)
               SELECT $1, $2, $3 WHERE
                   EXISTS (SELECT 1 FROM agent_preview_watcher WHERE session_id = $1 AND user_id = $2 AND expires_at > now())
                   OR ((SELECT count(*) FROM agent_preview_watcher WHERE session_id = $1 AND expires_at > now()) < $4
                       AND (EXISTS (SELECT 1 FROM agent_preview_watcher WHERE session_id = $1 AND expires_at > now())
                           OR (SELECT count(DISTINCT session_id) FROM agent_preview_watcher WHERE expires_at > now()) < $5))
               ON CONFLICT (session_id, user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at"#,
            session.as_uuid(), user.as_ref(), expires, limits.viewers, limits.sessions
        ).execute(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)
    }
    async fn watchers(
        &self,
        session: AgentSessionId,
        limit: i64,
    ) -> Result<Vec<MacroUserIdStr<'static>>, PreviewError> {
        sqlx::query_scalar!("SELECT user_id FROM agent_preview_watcher WHERE session_id = $1 AND expires_at > now() ORDER BY user_id LIMIT $2", session.as_uuid(), limit)
            .fetch_all(&self.pool).await.map_err(unavailable)?.into_iter().map(|u| MacroUserIdStr::try_from(u).map_err(|_| PreviewError::Unavailable)).collect()
    }
    #[tracing::instrument(skip_all, err)]
    async fn sweep(&self) -> Result<Vec<crate::domain::Preview>, PreviewError> {
        let transitions = sqlx::query!(r#"UPDATE agent_preview_lease l SET status = CASE WHEN l.expires_at <= now() THEN 'expired' ELSE 'offline' END WHERE status IN ('starting','ready') AND (l.expires_at <= now() OR (replica_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_preview_replica r WHERE r.id = l.replica_id AND r.expires_at > now()))) RETURNING metadata AS "metadata: Json<StoredPreview>", replica_id, status"#).fetch_all(&self.pool).await.map_err(unavailable)?;
        sqlx::query!("DELETE FROM agent_preview_credential WHERE expires_at <= now()")
            .execute(&self.pool)
            .await
            .map_err(unavailable)?;
        sqlx::query!(
            "DELETE FROM agent_preview_lease WHERE expires_at < now() - interval '5 minutes'"
        )
        .execute(&self.pool)
        .await
        .map_err(unavailable)?;
        sqlx::query!("DELETE FROM agent_preview_watcher WHERE expires_at <= now()")
            .execute(&self.pool)
            .await
            .map_err(unavailable)?;
        sqlx::query!("DELETE FROM agent_preview_replica r WHERE expires_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM agent_preview_lease l WHERE l.replica_id = r.id)").execute(&self.pool).await.map_err(unavailable)?;
        transitions
            .into_iter()
            .map(|r| record(r.metadata.0, r.replica_id, &r.status).map(|p| p.preview))
            .collect()
    }
}

#[cfg(test)]
mod test;
