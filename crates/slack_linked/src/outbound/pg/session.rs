//! The session service's storage: leases, account lifecycle, catalogue,
//! durable inbound, sends, read marks, history and sign-in.

use super::*;
use crate::domain::ports::SessionRepository;
use async_trait::async_trait;

/// Changes kept per account before the replica stops accepting more.
const MAX_QUEUED_INBOUND: i64 = 4096;
/// Attempts before a deferred change is dropped.
const MAX_INBOUND_ATTEMPTS: i32 = 20;

#[async_trait]
impl SessionRepository for PgSlackRepository {
    async fn discoverable_accounts(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
        sqlx::query_scalar!(
            r#"SELECT a.id FROM slack_account a
            WHERE (a.state IN ('connecting', 'connected') OR a.sign_out_requested)
              AND a.credentials IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM pg_locks l
                WHERE l.locktype = 'advisory' AND l.granted
                  AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('slack-account:' || a.id, 0))
            ORDER BY a.id LIMIT $1"#,
            limit
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
    }

    async fn begin_lease(&self, account: Uuid) -> ExternalChatResult<Lease> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let row = sqlx::query!(
            r#"UPDATE slack_account SET lease_epoch = lease_epoch + 1 WHERE id = $1
            RETURNING lease_epoch, user_id, team_id, team_domain, slack_user_id, state, generation,
                credentials, data_key_ciphertext, kms_key_id, encryption_version, sign_out_requested"#,
            account
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        let unknown = sqlx::query!(
            r#"UPDATE slack_send SET state = 'unknown', claimed_epoch = NULL, updated_at = now()
            WHERE account_id = $1 AND state = 'sending' AND dispatch_started_at IS NOT NULL"#,
            account
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?
        .rows_affected();
        sqlx::query!(
            "UPDATE slack_send SET state = 'pending', claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND state = 'sending'",
            account
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(Lease {
            scope: SessionScope {
                account_id: account,
                lease_epoch: row.lease_epoch,
            },
            user_id: row.user_id,
            team_id: row.team_id,
            team_domain: row.team_domain,
            slack_user_id: row.slack_user_id,
            state: parse(&row.state, "account state")?,
            generation: row.generation,
            credentials: stored_secret(
                row.credentials,
                row.data_key_ciphertext,
                row.kms_key_id,
                row.encryption_version,
            ),
            sign_out_requested: row.sign_out_requested,
            sends_marked_unknown: unknown,
        })
    }

    async fn release_lease(&self, scope: SessionScope) -> ExternalChatResult<()> {
        super::sends::release_sends(&self.pool, scope).await
    }

    async fn announce_released(&self, account: Uuid) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        notify(&mut tx, signals::ACCOUNT_RELEASED, account).await?;
        tx.commit().await.map_err(failure)
    }

    async fn connected(&self, scope: SessionScope, facts: &BootFacts) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, true).await?;
        if !account.state.is_active() {
            return Err(ExternalChatError::Disconnected.into());
        }
        sqlx::query!(
            r#"UPDATE slack_account SET state = 'connected', slack_user_id = $2, display_name = $3, team_name = $4,
                team_domain = $5, team_icon_url = $6, enterprise_id = $7, last_connected_at = now(), updated_at = now()
            WHERE id = $1"#,
            account.id,
            facts.slack_user_id,
            facts.display_name,
            facts.team_name,
            facts.team_domain,
            facts.team_icon_url,
            facts.enterprise_id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        notify_change(
            &mut tx,
            Change::Chats {
                provider: ExternalChatProvider::Slack,
                account_id: account.id,
            },
        )
        .await?;
        tx.commit().await.map_err(failure)
    }

    async fn session_ended(
        &self,
        scope: SessionScope,
        reason: EndedReason,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, true).await?;
        if account.state.is_active() {
            end_consent_in(
                &mut tx,
                account.id,
                AccountState::LoggedOut,
                Some(reason),
                false,
            )
            .await?;
        } else {
            // Ended after a disconnect: nothing left to sign out.
            self.wipe_in(&mut tx, account.id).await?;
        }
        tx.commit().await.map_err(failure)
    }

    async fn signed_out(&self, scope: SessionScope) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, true).await?;
        self.wipe_in(&mut tx, account.id).await?;
        tx.commit().await.map_err(failure)
    }

    async fn replace_catalogue(
        &self,
        scope: SessionScope,
        catalogue: &Catalogue,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, false).await?;
        for team in &catalogue.teams {
            sqlx::query!(
                r#"INSERT INTO slack_team (team_id, name, domain, icon_url) VALUES ($1, $2, $3, $4)
                ON CONFLICT (team_id) DO UPDATE SET name = excluded.name, domain = excluded.domain,
                    icon_url = excluded.icon_url, updated_at = now()"#,
                team.team_id,
                team.name,
                team.domain,
                team.icon_url
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        for user in &catalogue.users {
            sqlx::query!(
                r#"INSERT INTO slack_user (slack_user_id, team_id, display_name, real_name, avatar_url, is_bot, deleted)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (slack_user_id) DO UPDATE SET team_id = excluded.team_id, display_name = excluded.display_name,
                    real_name = excluded.real_name, avatar_url = excluded.avatar_url, is_bot = excluded.is_bot,
                    deleted = excluded.deleted, updated_at = now()"#,
                user.slack_user_id,
                user.team_id,
                user.display_name,
                user.real_name,
                user.avatar_url,
                user.is_bot,
                user.deleted
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        let ids: Vec<String> = catalogue
            .conversations
            .iter()
            .map(|conversation| conversation.conversation_id.clone())
            .collect();
        sqlx::query!(
            "DELETE FROM slack_conversation WHERE account_id = $1 AND NOT (conversation_id = ANY($2))",
            account.id,
            &ids
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        for conversation in &catalogue.conversations {
            sqlx::query!(
                r#"INSERT INTO slack_conversation (account_id, conversation_id, kind, name, topic, is_private, is_archived,
                    is_member, frozen_reason, connected_team_ids, direct_user_id, last_activity_at, unread_count,
                    last_read_ts, observed_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
                ON CONFLICT (account_id, conversation_id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
                    topic = excluded.topic, is_private = excluded.is_private, is_archived = excluded.is_archived,
                    is_member = excluded.is_member, frozen_reason = excluded.frozen_reason,
                    connected_team_ids = excluded.connected_team_ids, direct_user_id = excluded.direct_user_id,
                    last_activity_at = excluded.last_activity_at, unread_count = excluded.unread_count,
                    last_read_ts = excluded.last_read_ts, observed_at = excluded.observed_at"#,
                account.id,
                conversation.conversation_id,
                conversation.kind.as_ref(),
                conversation.name,
                conversation.topic,
                conversation.is_private,
                conversation.is_archived,
                conversation.is_member,
                conversation.frozen_reason,
                &conversation.connected_team_ids,
                conversation.direct_user_id,
                conversation.last_activity_at,
                i32::try_from(conversation.unread_count).unwrap_or(i32::MAX),
                conversation.last_read_ts
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        notify_change(
            &mut tx,
            Change::Chats {
                provider: ExternalChatProvider::Slack,
                account_id: account.id,
            },
        )
        .await?;
        tx.commit().await.map_err(failure)
    }

    async fn observed_chats(&self, scope: SessionScope) -> ExternalChatResult<Vec<ObservedChat>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, false).await?;
        let chats = sqlx::query!(
            r#"SELECT e.id, e.remote_id, m.latest_ts FROM slack_chat_membership m JOIN external_chat e ON e.id = m.chat_id
            WHERE m.account_id = $1 AND m.generation = $2 AND m.consent_ended_at IS NULL AND e.state = 'active'
            ORDER BY e.id"#,
            account.id,
            account.generation
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| ObservedChat {
            chat_id: row.id,
            conversation_id: row.remote_id,
            latest_ts: row.latest_ts,
        })
        .collect();
        tx.commit().await.map_err(failure)?;
        Ok(chats)
    }

    async fn enqueue_inbound(
        &self,
        scope: SessionScope,
        change: &InboundChange,
    ) -> ExternalChatResult<Uuid> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, false).await?;
        let queued = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM slack_inbound WHERE account_id = $1"#,
            account.id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if queued >= MAX_QUEUED_INBOUND {
            return Err(ExternalChatError::Backlogged.into());
        }
        let id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO slack_inbound (id, account_id, lease_epoch, event) VALUES ($1, $2, $3, $4)",
            id,
            account.id,
            scope.lease_epoch,
            serde_json::to_value(change).map_err(failure)?
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(id)
    }

    async fn queued_inbound(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<QueuedInbound>> {
        sqlx::query!(
            "SELECT id, event FROM slack_inbound WHERE account_id = $1 ORDER BY id LIMIT $2",
            scope.account_id,
            limit
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| {
            Ok(QueuedInbound {
                id: row.id,
                change: decode(row.event)?,
            })
        })
        .collect()
    }

    async fn ingest(
        &self,
        scope: SessionScope,
        queued: Uuid,
        change: &InboundChange,
    ) -> ExternalChatResult<Ingested> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, false).await?;
        let chats = ingest::observing_chats_in(&mut tx, &account, change.conversation_id()).await?;
        let mut outcome = Ingested::Ignored;
        for chat in &chats {
            match ingest::apply_in(&mut tx, &account, chat, change).await? {
                Ingested::Deferred => outcome = Ingested::Deferred,
                Ingested::Applied if outcome == Ingested::Ignored => outcome = Ingested::Applied,
                Ingested::Applied | Ingested::Ignored => {}
            }
        }
        if let InboundChange::ConversationIdChanged { old_id, new_id } = change {
            sqlx::query!(
                "UPDATE slack_conversation SET conversation_id = $3 WHERE account_id = $1 AND conversation_id = $2",
                account.id,
                old_id,
                new_id
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        if outcome == Ingested::Deferred {
            sqlx::query!(
                "UPDATE slack_inbound SET attempts = attempts + 1 WHERE id = $1",
                queued
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
            sqlx::query!(
                "DELETE FROM slack_inbound WHERE id = $1 AND attempts >= $2",
                queued,
                MAX_INBOUND_ATTEMPTS
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        } else {
            sqlx::query!("DELETE FROM slack_inbound WHERE id = $1", queued)
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
        }
        tx.commit().await.map_err(failure)?;
        Ok(outcome)
    }

    async fn claim_sends(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<ClaimedSend>> {
        super::sends::claim_sends(&self.pool, scope, limit).await
    }

    async fn begin_dispatch(
        &self,
        scope: SessionScope,
        send: Uuid,
        client_msg_id: &str,
    ) -> ExternalChatResult<bool> {
        super::sends::begin_dispatch(&self.pool, scope, send, client_msg_id).await
    }

    async fn record_send_outcome(
        &self,
        scope: SessionScope,
        send: Uuid,
        outcome: &SendOutcome,
    ) -> ExternalChatResult<()> {
        super::sends::record_send_outcome(&self.pool, scope, send, outcome).await
    }

    async fn pending_read_marks(&self, scope: SessionScope) -> ExternalChatResult<Vec<ReadMark>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, false).await?;
        let marks = sqlx::query!(
            r#"SELECT r.chat_id, e.remote_id, r.thread_ts, r.ts FROM slack_read_mark r
            JOIN external_chat e ON e.id = r.chat_id
            WHERE r.account_id = $1 ORDER BY r.requested_at LIMIT 100"#,
            account.id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| ReadMark {
            chat_id: row.chat_id,
            conversation_id: row.remote_id,
            thread_ts: (!row.thread_ts.is_empty()).then_some(row.thread_ts),
            ts: row.ts,
        })
        .collect();
        tx.commit().await.map_err(failure)?;
        Ok(marks)
    }

    async fn read_mark_done(&self, scope: SessionScope, mark: &ReadMark) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, false).await?;
        sqlx::query!(
            "DELETE FROM slack_read_mark WHERE chat_id = $1 AND account_id = $2 AND thread_ts = $3 AND ts = $4",
            mark.chat_id,
            account.id,
            mark.thread_ts.as_deref().unwrap_or_default(),
            mark.ts
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)
    }

    async fn history_work(&self, scope: SessionScope) -> ExternalChatResult<Vec<HistoryWork>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope, false).await?;
        let work = sqlx::query!(
            r#"UPDATE external_chat e SET backfill_state = 'running'
            FROM slack_chat_membership m
            WHERE m.chat_id = e.id AND m.account_id = $1 AND m.generation = $2 AND m.consent_ended_at IS NULL
              AND e.provider = 'slack' AND e.state = 'active' AND e.backfill_state IN ('pending', 'running')
            RETURNING e.id, e.remote_id, e.backfill_cursor, e.backfill_imported,
                COALESCE(e.backfill_requested_at, e.adopted_at) AS "requested_at!""#,
            account.id,
            account.generation
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| HistoryWork {
            chat_id: row.id,
            conversation_id: row.remote_id,
            before_ts: row
                .backfill_cursor
                .and_then(|cursor| cursor.as_str().map(str::to_owned)),
            imported: row.backfill_imported,
            not_before: row.requested_at - chrono::Duration::days(i64::from(crate::domain::models::BACKFILL_MAX_AGE_DAYS)),
        })
        .collect();
        tx.commit().await.map_err(failure)?;
        Ok(work)
    }

    async fn history_page(
        &self,
        scope: SessionScope,
        chat: Uuid,
        oldest_ts: Option<&str>,
        imported: i32,
        exhausted: bool,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        fence_in(&mut tx, scope, false).await?;
        sqlx::query!(
            r#"UPDATE external_chat SET
                backfill_cursor = COALESCE(to_jsonb($2::text), backfill_cursor),
                backfill_imported = backfill_imported + $3,
                backfill_state = CASE WHEN $4 THEN 'done'
                    WHEN backfill_imported + $3 >= $5 THEN 'partial' ELSE 'running' END
            WHERE id = $1 AND backfill_state = 'running'"#,
            chat,
            oldest_ts,
            imported,
            exhausted,
            crate::domain::models::BACKFILL_MESSAGE_LIMIT
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        notify_change(&mut tx, Change::Chat { chat_id: chat }).await?;
        tx.commit().await.map_err(failure)
    }

    async fn claim_login(&self, attempt: Uuid) -> ExternalChatResult<Option<LoginWork>> {
        super::logins::claim_login(&self.pool, attempt).await
    }

    async fn waiting_logins(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
        super::logins::waiting_logins(&self.pool, limit).await
    }

    async fn account_id_for(&self, user_id: &str, team_id: &str) -> ExternalChatResult<Uuid> {
        super::logins::account_id_for(&self.pool, user_id, team_id).await
    }

    async fn advance_login(&self, attempt: Uuid, advance: &LoginAdvance) -> ExternalChatResult<()> {
        super::logins::advance_login(&self.pool, attempt, advance).await
    }
}

impl PgSlackRepository {
    /// Drop the credentials of an ended account (a requested sign-out ran,
    /// or Slack already ended it).
    async fn wipe_in(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        account: Uuid,
    ) -> ExternalChatResult<()> {
        sqlx::query!(
            r#"UPDATE slack_account SET sign_out_requested = false, credentials = NULL, data_key_ciphertext = NULL,
                kms_key_id = NULL, encryption_version = NULL, updated_at = now()
            WHERE id = $1 AND state NOT IN ('connecting', 'connected')"#,
            account
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
        Ok(())
    }
}
