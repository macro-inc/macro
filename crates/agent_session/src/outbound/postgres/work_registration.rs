//! Work registrations and the writes that end them.

use super::*;
use crate::domain::work_registration::{
    EndedRegistration, Registered, WorkEndReason, WorkRegistration, WorkRegistrationId,
    WorkRegistrationRepo, WorkRegistrationState,
};

/// End a session's active registrations in the transaction that archives it, whatever archived it.
pub(super) async fn end_work_registrations_on_archive(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    session: AgentSessionId,
) -> Result<()> {
    sqlx::query!(
        r#"
        UPDATE work_registration
        SET ended_at = NOW(), end_reason = 'session_archived'
        WHERE agent_session_id = $1 AND ended_at IS NULL
        "#,
        session.as_uuid(),
    )
    .execute(&mut **tx)
    .await
    .context("end work registrations of an archived session")?;
    Ok(())
}

fn registration(
    id: Uuid,
    account_id: String,
    session: Uuid,
    registered_at: DateTime<Utc>,
) -> Result<WorkRegistration> {
    let account_id =
        MacroUserIdStr::try_from(account_id).context("stored work registration account id")?;
    Ok(WorkRegistration {
        id: WorkRegistrationId::new_from_uuid(id),
        account_id,
        session: AgentSessionId::new_from_uuid(session),
        registered_at,
    })
}

fn account_strings(accounts: &[MacroUserIdStr<'static>]) -> Vec<String> {
    accounts
        .iter()
        .map(|account| account.as_ref().to_owned())
        .collect()
}

impl<B: BotFacts + Clone + 'static> WorkRegistrationRepo for PgAgentSessionRepo<B> {
    async fn register(
        &self,
        account: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> Result<Registered> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin work registration")?;
        // Hold the row against an archive, which ends the session's registrations: it either
        // finished and is refused below, or waits and ends this one too.
        let archived = sqlx::query_scalar!(
            r#"
            SELECT archived_by IS NOT NULL AS "archived!"
            FROM agent_session
            WHERE id = $1
            FOR SHARE
            "#,
            session.as_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .context("check session for work registration")?;
        match archived {
            None => return Err(AgentSessionError::NotFound(session)),
            Some(true) => return Err(AgentSessionError::Archived(session)),
            Some(false) => {}
        }

        let inserted = sqlx::query!(
            r#"
            INSERT INTO work_registration (id, account_id, agent_session_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (account_id, agent_session_id) WHERE ended_at IS NULL DO NOTHING
            "#,
            WorkRegistrationId::generate().as_uuid(),
            account.as_ref(),
            session.as_uuid(),
        )
        .execute(&mut *transaction)
        .await
        .context("insert work registration")?;

        // A separate statement, so a registration a concurrent call just committed is visible.
        let row = sqlx::query!(
            r#"
            SELECT id, account_id, agent_session_id, registered_at
            FROM work_registration
            WHERE account_id = $1 AND agent_session_id = $2 AND ended_at IS NULL
            "#,
            account.as_ref(),
            session.as_uuid(),
        )
        .fetch_one(&mut *transaction)
        .await
        .context("read active work registration")?;
        transaction
            .commit()
            .await
            .context("commit work registration")?;
        Ok(Registered {
            registration: registration(
                row.id,
                row.account_id,
                row.agent_session_id,
                row.registered_at,
            )?,
            created: inserted.rows_affected() > 0,
        })
    }

    async fn unregister(
        &self,
        account: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> Result<bool> {
        let ended = sqlx::query!(
            r#"
            UPDATE work_registration
            SET ended_at = NOW(), end_reason = 'unregistered'
            WHERE account_id = $1 AND agent_session_id = $2 AND ended_at IS NULL
            "#,
            account.as_ref(),
            session.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .context("end work registration")?;
        Ok(ended.rows_affected() > 0)
    }

    async fn active_registrations(
        &self,
        accounts: &[MacroUserIdStr<'static>],
        limit: u32,
    ) -> Result<Vec<WorkRegistration>> {
        let rows = sqlx::query!(
            r#"
            SELECT registration.id, registration.account_id, registration.agent_session_id,
                   registration.registered_at
            FROM work_registration registration
            JOIN agent_session session ON session.id = registration.agent_session_id
            WHERE registration.account_id = ANY($1)
              AND registration.ended_at IS NULL
              AND session.archived_by IS NULL
            ORDER BY registration.registered_at DESC, registration.id DESC
            LIMIT $2
            "#,
            &account_strings(accounts),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("list active work registrations")?;
        rows.into_iter()
            .map(|row| {
                registration(
                    row.id,
                    row.account_id,
                    row.agent_session_id,
                    row.registered_at,
                )
            })
            .collect()
    }

    async fn registration_states(
        &self,
        accounts: &[MacroUserIdStr<'static>],
        sessions: &[AgentSessionId],
        ended_after: DateTime<Utc>,
    ) -> Result<Vec<WorkRegistrationState>> {
        let session_ids: Vec<Uuid> = sessions.iter().map(|session| session.as_uuid()).collect();
        // Ended rows first, so a client applying them in order keeps the account's newer
        // registration of the same session.
        let rows = sqlx::query!(
            r#"
            SELECT registration.id, registration.account_id, registration.agent_session_id,
                   registration.registered_at,
                   registration.ended_at IS NOT NULL AS "ended!",
                   session.archived_by IS NOT NULL AS "session_archived!"
            FROM work_registration registration
            JOIN agent_session session ON session.id = registration.agent_session_id
            WHERE registration.agent_session_id = ANY($1)
              AND registration.account_id = ANY($2)
              AND (registration.ended_at IS NULL OR registration.ended_at > $3)
            ORDER BY (registration.ended_at IS NULL), registration.registered_at
            "#,
            &session_ids,
            &account_strings(accounts),
            ended_after,
        )
        .fetch_all(&self.pool)
        .await
        .context("read work registration states")?;
        rows.into_iter()
            .map(|row| {
                Ok(WorkRegistrationState {
                    registration: registration(
                        row.id,
                        row.account_id,
                        row.agent_session_id,
                        row.registered_at,
                    )?,
                    ended: row.ended,
                    session_archived: row.session_archived,
                })
            })
            .collect()
    }

    async fn has_current_registrations(
        &self,
        session: AgentSessionId,
        ended_after: DateTime<Utc>,
    ) -> Result<bool> {
        let current = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM work_registration
                WHERE agent_session_id = $1 AND (ended_at IS NULL OR ended_at > $2)
            ) AS "current!"
            "#,
            session.as_uuid(),
            ended_after,
        )
        .fetch_one(&self.pool)
        .await
        .context("check current work registrations")?;
        Ok(current)
    }

    async fn end_for_finished_pull_requests(
        &self,
        github_key: &str,
    ) -> Result<Vec<AgentSessionId>> {
        // The guard on `ended_at` makes a concurrent replica's update of the same row end nothing.
        let sessions = sqlx::query_scalar!(
            r#"
            UPDATE work_registration
            SET ended_at = NOW(), end_reason = 'pull_request_finished'
            WHERE ended_at IS NULL
              AND agent_session_id IN (
                  SELECT link.agent_session_id
                  FROM agent_session_pull_request link
                  WHERE lower(link.github_key) = lower($1)
                    AND NOT EXISTS (
                        SELECT 1
                        FROM agent_session_pull_request other
                        LEFT JOIN github_pull_request pull_request
                            ON lower(pull_request.github_key) = lower(other.github_key)
                        WHERE other.agent_session_id = link.agent_session_id
                          AND pull_request.status IS DISTINCT FROM 'merged'
                          AND pull_request.status IS DISTINCT FROM 'closed'
                    )
              )
            RETURNING agent_session_id
            "#,
            github_key,
        )
        .fetch_all(&self.pool)
        .await
        .context("end work registrations for finished pull requests")?;
        Ok(sessions
            .into_iter()
            .map(AgentSessionId::new_from_uuid)
            .collect())
    }

    async fn end_due_registrations(
        &self,
        idle_before: DateTime<Utc>,
        blocked_before: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<EndedRegistration>> {
        // One statement, guarded on `ended_at`: replicas sweeping together end each row once, and
        // links with no stored pull request count as unfinished.
        let rows = sqlx::query!(
            r#"
            WITH due AS (
                SELECT registration.id,
                    CASE
                        WHEN pull_requests.finished THEN 'pull_request_finished'
                        WHEN session.archived_by IS NOT NULL THEN 'session_archived'
                        WHEN session.turn_state = 'blocked' THEN 'blocked_timeout'
                        ELSE 'idle'
                    END AS reason
                FROM work_registration registration
                JOIN agent_session session ON session.id = registration.agent_session_id
                CROSS JOIN LATERAL (
                    SELECT COALESCE(
                        bool_and(COALESCE(pull_request.status IN ('merged', 'closed'), false)),
                        false
                    ) AS finished
                    FROM agent_session_pull_request link
                    LEFT JOIN github_pull_request pull_request
                        ON lower(pull_request.github_key) = lower(link.github_key)
                    WHERE link.agent_session_id = session.id
                ) pull_requests
                WHERE registration.ended_at IS NULL
                  AND (
                      pull_requests.finished
                      OR session.archived_by IS NOT NULL
                      OR (session.turn_state = 'blocked' AND session.modified_at < $2)
                      OR (session.turn_state IS DISTINCT FROM 'blocked'
                          AND session.modified_at < $1)
                  )
                ORDER BY registration.registered_at
                LIMIT $3
            )
            UPDATE work_registration registration
            SET ended_at = NOW(),
                end_reason = due.reason::work_registration_end_reason
            FROM due
            WHERE registration.id = due.id AND registration.ended_at IS NULL
            RETURNING registration.agent_session_id, due.reason AS "reason!"
            "#,
            idle_before,
            blocked_before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("end due work registrations")?;
        rows.into_iter()
            .map(|row| {
                let reason = row
                    .reason
                    .parse::<WorkEndReason>()
                    .context("stored work registration end reason")?;
                Ok(EndedRegistration {
                    session: AgentSessionId::new_from_uuid(row.agent_session_id),
                    reason,
                })
            })
            .collect()
    }
}
