//! Sign-in attempts: DSS records input, a session replica claims and
//! advances them.

use super::*;
use crate::domain::ports::{LoginRepository, LoginStart};
use async_trait::async_trait;
use external_chat::signals::trace_context;
use macro_user_id::user_id::MacroUserIdStr;

/// A replica works on a claimed attempt at most this long before another
/// may take it over.
const LOGIN_CLAIM_SECONDS: f64 = 60.0;

struct LoginRow {
    id: Uuid,
    step: String,
    step_data: serde_json::Value,
    expires_at: chrono::DateTime<chrono::Utc>,
    expired: bool,
}

fn login(row: LoginRow) -> ExternalChatResult<Login> {
    let name: LoginStepName = parse(&row.step, "login step")?;
    let step = if row.expired && !name.is_final() {
        LoginStep::Failed {
            reason: LoginFailure::Expired,
        }
    } else {
        decode(row.step_data)?
    };
    Ok(Login {
        id: row.id,
        step,
        expires_at: row.expires_at,
    })
}

fn step_data(step: &LoginStep) -> ExternalChatResult<serde_json::Value> {
    serde_json::to_value(step).map_err(failure)
}

#[async_trait]
impl LoginRepository for PgSlackRepository {
    async fn begin_login(
        &self,
        user: &MacroUserIdStr<'_>,
        start: LoginStart,
    ) -> ExternalChatResult<Login> {
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        cancel_open_in(&mut tx, user).await?;
        let (id, input, sealed) = match start {
            LoginStart::Email { email } => (Uuid::now_v7(), LoginInput::Email { email }, None),
            LoginStart::Session {
                attempt,
                source,
                sealed,
            } => (attempt, LoginInput::Session { source }, Some(sealed)),
        };
        let input = serde_json::to_value(&input).map_err(failure)?;
        let working = step_data(&LoginStep::Working)?;
        let row = sqlx::query_as!(
            LoginRow,
            r#"INSERT INTO slack_login_attempt (id, user_id, step, step_data, input, sealed_input, sealed_input_key,
                kms_key_id, encryption_version, traceparent, expires_at)
            VALUES ($1, $2, 'working', $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10))
            RETURNING id, step, step_data, expires_at, false AS "expired!""#,
            id,
            user,
            working,
            input,
            sealed.as_ref().map(|sealed| sealed.ciphertext.as_slice()),
            sealed.as_ref().map(|sealed| sealed.data_key.as_slice()),
            sealed.as_ref().map(|sealed| sealed.kms_key_id.as_str()),
            sealed.as_ref().map(|sealed| sealed.encryption_version),
            trace_context::current(),
            LOGIN_TTL_MINUTES
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        notify(&mut tx, signals::LOGIN_REQUESTED, id).await?;
        tx.commit().await.map_err(failure)?;
        login(row)
    }

    async fn login(&self, user: &MacroUserIdStr<'_>, attempt: Uuid) -> ExternalChatResult<Login> {
        let row = sqlx::query_as!(
            LoginRow,
            r#"SELECT id, step, step_data, expires_at, expires_at < now() AS "expired!"
            FROM slack_login_attempt WHERE id = $1 AND user_id = $2"#,
            attempt,
            user.as_ref()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        login(row)
    }

    async fn submit_login_input(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
        expected: LoginStepName,
        input: LoginInput,
    ) -> ExternalChatResult<Login> {
        let expected: &'static str = expected.into();
        let input = serde_json::to_value(&input).map_err(failure)?;
        let working = step_data(&LoginStep::Working)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let row = sqlx::query_as!(
            LoginRow,
            r#"UPDATE slack_login_attempt SET step = 'working', step_data = $4, input = $5, traceparent = $6,
                claimed_until = NULL, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND step = $3 AND expires_at > now()
            RETURNING id, step, step_data, expires_at, false AS "expired!""#,
            attempt,
            user.as_ref(),
            expected,
            working,
            input,
            trace_context::current()
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::Conflict)?;
        notify(&mut tx, signals::LOGIN_REQUESTED, attempt).await?;
        tx.commit().await.map_err(failure)?;
        login(row)
    }

    async fn cancel_login(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
    ) -> ExternalChatResult<Login> {
        let cancelled = step_data(&LoginStep::Cancelled)?;
        sqlx::query!(
            r#"UPDATE slack_login_attempt SET step = 'cancelled', step_data = $3, input = NULL,
                sealed_input = NULL, sealed_input_key = NULL, sealed_state = NULL, sealed_state_key = NULL,
                claimed_until = NULL, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND step NOT IN ('done', 'failed', 'cancelled')"#,
            attempt,
            user.as_ref(),
            cancelled
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        self.login(user, attempt).await
    }
}

/// Cancel the person's open attempt, so they have at most one.
async fn cancel_open_in(tx: &mut Transaction<'_, Postgres>, user: &str) -> ExternalChatResult<()> {
    let cancelled = step_data(&LoginStep::Cancelled)?;
    sqlx::query!(
        r#"UPDATE slack_login_attempt SET step = 'cancelled', step_data = $2, input = NULL,
            sealed_input = NULL, sealed_input_key = NULL, sealed_state = NULL, sealed_state_key = NULL,
            claimed_until = NULL, updated_at = now()
        WHERE user_id = $1 AND step NOT IN ('done', 'failed', 'cancelled')"#,
        user,
        cancelled
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// Claim a live attempt that waits in `working` with input.
pub(super) async fn claim_login(pool: &PgPool, attempt: Uuid) -> ExternalChatResult<Option<LoginWork>> {
    let Some(row) = sqlx::query!(
        r#"UPDATE slack_login_attempt SET claimed_until = now() + make_interval(secs => $2), updated_at = now()
        WHERE id = $1 AND step = 'working' AND expires_at > now()
          AND (claimed_until IS NULL OR claimed_until < now())
        RETURNING id, user_id, step_data, input, sealed_input, sealed_input_key, sealed_state, sealed_state_key,
            kms_key_id, encryption_version, traceparent"#,
        attempt,
        LOGIN_CLAIM_SECONDS
    )
    .fetch_optional(pool)
    .await
    .map_err(failure)?
    else {
        return Ok(None);
    };
    let input = row.input.map(decode::<LoginInput>).transpose()?;
    Ok(Some(LoginWork {
        id: row.id,
        user_id: row.user_id,
        step_data: row.step_data,
        input,
        sealed_input: stored_secret(
            row.sealed_input,
            row.sealed_input_key,
            row.kms_key_id.clone(),
            row.encryption_version,
        ),
        sealed_state: stored_secret(
            row.sealed_state,
            row.sealed_state_key,
            row.kms_key_id,
            row.encryption_version,
        ),
        traceparent: row.traceparent,
    }))
}

/// Attempts in `working` nobody holds (a missed signal, a dead replica), and
/// expired attempts to close.
pub(super) async fn waiting_logins(pool: &PgPool, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
    let expired = step_data(&LoginStep::Failed {
        reason: LoginFailure::Expired,
    })?;
    sqlx::query!(
        r#"UPDATE slack_login_attempt SET step = 'failed', step_data = $1, input = NULL,
            sealed_input = NULL, sealed_input_key = NULL, sealed_state = NULL, sealed_state_key = NULL,
            claimed_until = NULL, updated_at = now()
        WHERE expires_at < now() AND step NOT IN ('done', 'failed', 'cancelled')"#,
        expired
    )
    .execute(pool)
    .await
    .map_err(failure)?;
    sqlx::query_scalar!(
        r#"SELECT id FROM slack_login_attempt
        WHERE step = 'working' AND (claimed_until IS NULL OR claimed_until < now())
        ORDER BY updated_at LIMIT $1"#,
        limit
    )
    .fetch_all(pool)
    .await
    .map_err(failure)
}

/// The person's account for a team, else a fresh id.
pub(super) async fn account_id_for(
    pool: &PgPool,
    user_id: &str,
    team_id: &str,
) -> ExternalChatResult<Uuid> {
    Ok(sqlx::query_scalar!(
        "SELECT id FROM slack_account WHERE user_id = $1 AND team_id = $2",
        user_id,
        team_id
    )
    .fetch_optional(pool)
    .await
    .map_err(failure)?
    .unwrap_or_else(Uuid::now_v7))
}

/// Move a claimed attempt on and drop its consumed input.
pub(super) async fn advance_login(
    pool: &PgPool,
    attempt: Uuid,
    advance: &LoginAdvance,
) -> ExternalChatResult<()> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let user_id = sqlx::query_scalar!(
        "SELECT user_id FROM slack_login_attempt WHERE id = $1 AND step = 'working' FOR UPDATE",
        attempt
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(failure)?
    // Cancelled or expired meanwhile: drop what the replica produced.
    .ok_or(ExternalChatError::Conflict)?;
    let (step, state) = match advance {
        LoginAdvance::Wait { step, state } => (step.clone(), state.clone()),
        LoginAdvance::Failed(reason) => (LoginStep::Failed { reason: *reason }, None),
        LoginAdvance::Done {
            workspaces,
            skipped,
        } => {
            let mut accounts = Vec::with_capacity(workspaces.len());
            for workspace in workspaces {
                accounts.push(sign_in_account_in(&mut tx, &user_id, workspace).await?);
            }
            (
                LoginStep::Done {
                    accounts,
                    skipped: skipped.clone(),
                },
                None,
            )
        }
    };
    let name: &'static str = step.name().into();
    sqlx::query!(
        r#"UPDATE slack_login_attempt SET step = $2, step_data = $3, input = NULL,
            sealed_input = NULL, sealed_input_key = NULL,
            sealed_state = $4, sealed_state_key = $5,
            kms_key_id = COALESCE($6, kms_key_id), encryption_version = COALESCE($7, encryption_version),
            claimed_until = NULL, updated_at = now()
        WHERE id = $1"#,
        attempt,
        name,
        step_data(&step)?,
        state.as_ref().map(|state| state.ciphertext.as_slice()),
        state.as_ref().map(|state| state.data_key.as_slice()),
        state.as_ref().map(|state| state.kms_key_id.as_str()),
        state.as_ref().map(|state| state.encryption_version)
    )
    .execute(&mut *tx)
    .await
    .map_err(failure)?;
    tx.commit().await.map_err(failure)
}

/// Create the person's account for a workspace, or reconnect it: new
/// credentials, generation + 1, `connecting`.
async fn sign_in_account_in(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &str,
    workspace: &SignedInWorkspace,
) -> ExternalChatResult<Account> {
    let row = sqlx::query!(
        r#"INSERT INTO slack_account (id, user_id, team_id, enterprise_id, team_name, team_domain, team_icon_url,
            slack_user_id, state, credentials, data_key_ciphertext, kms_key_id, encryption_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'connecting', $9, $10, $11, $12)
        ON CONFLICT (user_id, team_id) DO UPDATE SET
            enterprise_id = excluded.enterprise_id, team_name = excluded.team_name,
            team_domain = excluded.team_domain, team_icon_url = excluded.team_icon_url,
            slack_user_id = excluded.slack_user_id, state = 'connecting', ended_reason = NULL,
            generation = slack_account.generation + 1, sign_out_requested = false,
            credentials = excluded.credentials, data_key_ciphertext = excluded.data_key_ciphertext,
            kms_key_id = excluded.kms_key_id, encryption_version = excluded.encryption_version,
            updated_at = now()
        RETURNING id, generation, last_connected_at, display_name"#,
        workspace.account_id,
        user_id,
        workspace.team_id,
        workspace.enterprise_id,
        workspace.team_name,
        workspace.team_domain,
        workspace.team_icon_url,
        workspace.slack_user_id,
        workspace.credentials.ciphertext,
        workspace.credentials.data_key,
        workspace.credentials.kms_key_id,
        workspace.credentials.encryption_version
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    // Credentials are sealed for the account id; a different existing id
    // would never decrypt them.
    if row.id != workspace.account_id {
        return Err(ExternalChatError::Conflict.into());
    }
    notify(tx, signals::ACCOUNT_CHANGED, row.id).await?;
    Ok(Account {
        id: row.id,
        team_id: workspace.team_id.clone(),
        team_name: workspace.team_name.clone(),
        team_domain: workspace.team_domain.clone(),
        team_icon_url: workspace.team_icon_url.clone(),
        enterprise_id: workspace.enterprise_id.clone(),
        slack_user_id: Some(workspace.slack_user_id.clone()),
        display_name: row.display_name,
        state: AccountState::Connecting,
        ended_reason: None,
        authorization_generation: row.generation,
        last_connected_at: row.last_connected_at,
    })
}
