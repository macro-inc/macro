//! The person's accounts, disconnecting and history imports.

use super::*;
use crate::domain::ports::AccountRepository;
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;

pub(super) struct AccountRow {
    pub id: Uuid,
    pub team_id: String,
    pub team_name: String,
    pub team_domain: String,
    pub team_icon_url: Option<String>,
    pub enterprise_id: Option<String>,
    pub slack_user_id: Option<String>,
    pub display_name: Option<String>,
    pub state: String,
    pub ended_reason: Option<String>,
    pub generation: i64,
    pub last_connected_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub(super) fn account(row: AccountRow) -> ExternalChatResult<Account> {
    Ok(Account {
        id: row.id,
        team_id: row.team_id,
        team_name: row.team_name,
        team_domain: row.team_domain,
        team_icon_url: row.team_icon_url,
        enterprise_id: row.enterprise_id,
        slack_user_id: row.slack_user_id,
        display_name: row.display_name,
        state: parse(&row.state, "account state")?,
        ended_reason: row
            .ended_reason
            .as_deref()
            .map(|reason| parse(reason, "ended reason"))
            .transpose()?,
        authorization_generation: row.generation,
        last_connected_at: row.last_connected_at,
    })
}

#[async_trait]
impl AccountRepository for PgSlackRepository {
    async fn accounts(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<Vec<Account>> {
        sqlx::query_as!(
            AccountRow,
            r#"SELECT id, team_id, team_name, team_domain, team_icon_url, enterprise_id, slack_user_id,
                display_name, state, ended_reason, generation, last_connected_at
            FROM slack_account WHERE user_id = $1 ORDER BY created_at, id"#,
            user.as_ref()
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(account)
        .collect()
    }

    async fn disconnect(
        &self,
        user: &MacroUserIdStr<'_>,
        account: Uuid,
        generation: i64,
        sign_out: bool,
    ) -> ExternalChatResult<bool> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let state = sqlx::query_scalar!(
            "SELECT state FROM slack_account WHERE id = $1 AND user_id = $2 FOR NO KEY UPDATE",
            account,
            user.as_ref()
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        let active = parse::<AccountState>(&state, "account state")?.is_active();
        let current = sqlx::query_scalar!(
            "SELECT generation FROM slack_account WHERE id = $1",
            account
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if !active || current != generation {
            return Ok(false);
        }
        end_consent_in(&mut tx, account, AccountState::Disconnected, None, sign_out).await?;
        tx.commit().await.map_err(failure)?;
        Ok(true)
    }

    async fn import_history(
        &self,
        user: &MacroUserIdStr<'_>,
        chat: Uuid,
    ) -> ExternalChatResult<bool> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let row = sqlx::query!(
            r#"SELECT c.user_id, c.backfill_state FROM external_chat c
            WHERE c.id = $1 AND c.provider = 'slack' AND c.state = 'active' FOR UPDATE"#,
            chat
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        if row.user_id != user.as_ref() {
            return Err(ExternalChatError::Forbidden.into());
        }
        if row.backfill_state.as_deref() != Some("partial") {
            return Ok(false);
        }
        sqlx::query!(
            "UPDATE external_chat SET backfill_state = 'pending', backfill_imported = 0, backfill_requested_at = now() WHERE id = $1",
            chat
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        let observers = sqlx::query_scalar!(
            r#"SELECT m.account_id FROM slack_chat_membership m JOIN slack_account a ON a.id = m.account_id
            WHERE m.chat_id = $1 AND m.consent_ended_at IS NULL AND m.generation = a.generation"#,
            chat
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        for account in observers {
            notify(&mut tx, signals::HISTORY_REQUESTED, account).await?;
        }
        notify_change(&mut tx, Change::Chat { chat_id: chat }).await?;
        tx.commit().await.map_err(failure)?;
        Ok(true)
    }
}
