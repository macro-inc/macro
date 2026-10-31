//! Session-service transitions, each fenced by the replica's lease epoch.

use super::*;
use crate::domain::{events::*, ports::SessionRepository};
use async_trait::async_trait;
use chrono::{DateTime, Utc};

struct WorkRow {
    id: Uuid,
    account_id: Uuid,
    state: String,
    expected_identity_jid: Option<String>,
    expires_at: DateTime<Utc>,
    passkey_response: Option<serde_json::Value>,
}

fn work(row: WorkRow) -> ExternalChatResult<PairingWork> {
    Ok(PairingWork {
        id: row.id,
        account_id: row.account_id,
        state: PairingState::parse(&row.state)
            .ok_or_else(|| corrupt(format_args!("state {:?}", row.state)))?,
        expected_identity_jid: row.expected_identity_jid,
        expires_at: row.expires_at,
        passkey_response: row.passkey_response,
    })
}

/// End a live transaction as failed, disconnecting the account it was pairing.
async fn fail_pairing_in(
    tx: &mut Transaction<'_, Postgres>,
    pairing: Uuid,
    account: Uuid,
    generation: i64,
) -> ExternalChatResult<()> {
    end_pairing_in(tx, pairing, account, generation, PairingState::Failed).await
}

/// Ends a live transaction as `state` and returns its account to disconnected.
async fn end_pairing_in(
    tx: &mut Transaction<'_, Postgres>,
    pairing: Uuid,
    account: Uuid,
    generation: i64,
    state: PairingState,
) -> ExternalChatResult<()> {
    sqlx::query!(
        "UPDATE whatsapp_pairing SET state = $2, consumed_at = clock_timestamp(), qr_code = NULL, pair_code = NULL, passkey_challenge = NULL, passkey_response = NULL, updated_at = now() WHERE id = $1",
        pairing,
        state.as_str()
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = 'disconnected', generation = generation + 1, updated_at = now() WHERE id = $1 AND generation = $2 AND state = 'pairing'",
        account,
        generation
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

#[async_trait]
impl SessionRepository for PgWhatsAppRepository {
    async fn account_state(&self, account: Uuid) -> ExternalChatResult<Option<AccountState>> {
        sqlx::query_scalar!(
            "SELECT state FROM whatsapp_linked_account WHERE id = $1",
            account
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(|state| account_state(&state))
        .transpose()
    }

    async fn discoverable_accounts(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        accounts::expire_pairings_in(&mut tx, None, None, None).await?;
        let accounts = sqlx::query_scalar!(
            r#"SELECT a.id FROM whatsapp_linked_account a
            WHERE (a.state = 'connected' OR EXISTS (
                SELECT 1 FROM whatsapp_pairing p WHERE p.account_id = a.id AND p.consumed_at IS NULL AND p.expires_at > now()))
              AND NOT EXISTS (
                SELECT 1 FROM pg_locks l
                WHERE l.locktype = 'advisory' AND l.objsubid = 1
                  AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
                  AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('whatsapp-account:' || a.id::text, 0))
            ORDER BY a.updated_at, a.id LIMIT $1"#,
            limit
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(accounts)
    }

    async fn announce_released(&self, account: Uuid) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        notify(&mut tx, signals::ACCOUNT_RELEASED, account).await?;
        tx.commit().await.map_err(failure)
    }

    async fn fleet_health(&self) -> ExternalChatResult<FleetHealth> {
        let row = sqlx::query!(
            r#"WITH needing AS (
                SELECT EXISTS (
                SELECT 1 FROM pg_locks l
                WHERE l.locktype = 'advisory' AND l.objsubid = 1
                  AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
                  AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('whatsapp-account:' || a.id::text, 0)) AS locked
                FROM whatsapp_linked_account a WHERE (a.state = 'connected' OR EXISTS (
                SELECT 1 FROM whatsapp_pairing p WHERE p.account_id = a.id AND p.consumed_at IS NULL AND p.expires_at > now())))
            SELECT
                (SELECT count(*) FROM needing WHERE locked) AS "running!",
                (SELECT count(*) FROM needing WHERE NOT locked) AS "unowned!",
                (SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::bigint FROM whatsapp_inbound_event) AS "oldest!""#
        )
        .fetch_one(&self.pool)
        .await
        .map_err(failure)?;
        Ok(FleetHealth {
            accounts_running: row.running.max(0) as u64,
            accounts_unowned: row.unowned.max(0) as u64,
            oldest_unprocessed_inbound_seconds: row.oldest.max(0) as u64,
        })
    }

    async fn enqueue_inbound(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<()> {
        PgWhatsAppRepository::enqueue_inbound(self, scope, event).await
    }

    async fn begin_lease(&self, account: Uuid) -> ExternalChatResult<Lease> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let row = sqlx::query!(
            r#"UPDATE whatsapp_linked_account SET lease_epoch = lease_epoch + 1 WHERE id = $1
            RETURNING user_id, identity_jid, state, lease_epoch"#,
            account
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        let unknown = sqlx::query!(
            "UPDATE whatsapp_send SET state = 'unknown', claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND state = 'sending' AND dispatch_started_at IS NOT NULL",
            account
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?
        .rows_affected();
        sqlx::query!(
            "UPDATE whatsapp_send SET state = 'pending', claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND state = 'sending' AND dispatch_started_at IS NULL",
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
            identity_jid: row.identity_jid,
            state: account_state(&row.state)?,
            sends_marked_unknown: unknown,
        })
    }

    async fn release_lease(&self, scope: SessionScope) -> ExternalChatResult<()> {
        self.release_sends(scope).await
    }

    async fn pairing_work(&self, pairing: Uuid) -> ExternalChatResult<Option<PairingWork>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        accounts::expire_pairings_in(&mut tx, None, Some(pairing), None).await?;
        let row = sqlx::query_as!(
            WorkRow,
            "SELECT id, account_id, state, expected_identity_jid, expires_at, passkey_response FROM whatsapp_pairing WHERE id = $1",
            pairing
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        row.map(work).transpose()
    }

    async fn live_pairing(&self, scope: SessionScope) -> ExternalChatResult<Option<PairingWork>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        accounts::expire_pairings_in(&mut tx, None, None, Some(scope.account_id)).await?;
        let account = fence_in(&mut tx, scope).await?;
        let row = sqlx::query_as!(
            WorkRow,
            r#"SELECT id, account_id, state, expected_identity_jid, expires_at, passkey_response FROM whatsapp_pairing
            WHERE account_id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()"#,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        row.map(work).transpose()
    }

    async fn update_pairing(
        &self,
        scope: SessionScope,
        pairing: Uuid,
        update: &PairingUpdate,
    ) -> ExternalChatResult<PairingWork> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_exclusive_in(&mut tx, scope).await?;
        accounts::expire_pairings_in(&mut tx, None, Some(pairing), Some(scope.account_id)).await?;
        let current = sqlx::query!(
            r#"SELECT generation, consumed_at, expected_identity_jid FROM whatsapp_pairing
            WHERE id = $1 AND account_id = $2 FOR UPDATE"#,
            pairing,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        let mut rejection = None;
        if current.consumed_at.is_none() {
            if current.generation != account.generation {
                fail_pairing_in(&mut tx, pairing, account.id, current.generation).await?;
                rejection = Some(ExternalChatError::Conflict);
            } else {
                match update {
                    PairingUpdate::Qr(code) => {
                        sqlx::query!(
                            "UPDATE whatsapp_pairing SET state = 'qr', qr_code = $2, updated_at = now() WHERE id = $1",
                            pairing,
                            code
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(failure)?;
                    }
                    PairingUpdate::PairCode(code) => {
                        sqlx::query!(
                            "UPDATE whatsapp_pairing SET state = 'qr', pair_code = $2, updated_at = now() WHERE id = $1",
                            pairing,
                            code
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(failure)?;
                    }
                    PairingUpdate::Passkey { challenge } => {
                        sqlx::query!(
                            "UPDATE whatsapp_pairing SET state = 'passkey', passkey_challenge = $2, passkey_response = NULL, updated_at = now() WHERE id = $1",
                            pairing,
                            challenge
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(failure)?;
                    }
                    PairingUpdate::Expired => {
                        end_pairing_in(
                            &mut tx,
                            pairing,
                            account.id,
                            account.generation,
                            PairingState::Expired,
                        )
                        .await?;
                    }
                    PairingUpdate::Failed => {
                        fail_pairing_in(&mut tx, pairing, account.id, account.generation).await?;
                    }
                    PairingUpdate::Success { identity_jid } => {
                        let taken = sqlx::query_scalar!(
                            "SELECT id FROM whatsapp_linked_account WHERE identity_jid = $1 AND id <> $2",
                            identity_jid,
                            account.id
                        )
                        .fetch_optional(&mut *tx)
                        .await
                        .map_err(failure)?;
                        if current
                            .expected_identity_jid
                            .as_deref()
                            .is_some_and(|expected| expected != identity_jid)
                        {
                            // A reconnect must keep its verified identity.
                            fail_pairing_in(&mut tx, pairing, account.id, account.generation)
                                .await?;
                            rejection = Some(ExternalChatError::Conflict);
                        } else if taken.is_some() {
                            // A verified identity belongs to one Macro person.
                            fail_pairing_in(&mut tx, pairing, account.id, account.generation)
                                .await?;
                            rejection = Some(ExternalChatError::Forbidden);
                        } else {
                            sqlx::query!(
                                "UPDATE whatsapp_linked_account SET identity_jid = $2, state = 'connected', updated_at = now() WHERE id = $1",
                                account.id,
                                identity_jid
                            )
                            .execute(&mut *tx)
                            .await
                            .map_err(failure)?;
                            sqlx::query!(
                                "UPDATE whatsapp_pairing SET state = 'success', consumed_at = clock_timestamp(), qr_code = NULL, pair_code = NULL, passkey_challenge = NULL, passkey_response = NULL, updated_at = now() WHERE id = $1",
                                pairing
                            )
                            .execute(&mut *tx)
                            .await
                            .map_err(failure)?;
                        }
                    }
                }
            }
        }
        let row = sqlx::query_as!(
            WorkRow,
            "SELECT id, account_id, state, expected_identity_jid, expires_at, passkey_response FROM whatsapp_pairing WHERE id = $1",
            pairing
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        match rejection {
            Some(error) => Err(error.into()),
            None => work(row),
        }
    }

    async fn take_passkey_response(
        &self,
        scope: SessionScope,
        pairing: Uuid,
    ) -> ExternalChatResult<Option<serde_json::Value>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let response = sqlx::query_scalar!(
            r#"UPDATE whatsapp_pairing p SET passkey_response = NULL, updated_at = now()
            FROM (SELECT id, passkey_response FROM whatsapp_pairing WHERE id = $1 AND account_id = $2 AND consumed_at IS NULL FOR UPDATE) old
            WHERE p.id = old.id AND old.passkey_response IS NOT NULL
            RETURNING old.passkey_response AS "response!""#,
            pairing,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(response)
    }

    async fn claim_media_imports(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<MediaImport>> {
        PgWhatsAppRepository::claim_media_imports(self, scope, limit).await
    }

    async fn complete_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        bytes: &[u8],
    ) -> ExternalChatResult<()> {
        PgWhatsAppRepository::complete_media_import(self, scope, attachment, bytes).await
    }

    async fn fail_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        failure: MediaFailure,
    ) -> ExternalChatResult<()> {
        PgWhatsAppRepository::fail_media_import(self, scope, attachment, failure).await
    }

    async fn outbound_media(
        &self,
        scope: SessionScope,
        send: Uuid,
    ) -> ExternalChatResult<OutboundMedia> {
        PgWhatsAppRepository::outbound_media(self, scope, send).await
    }

    async fn logged_out(&self, scope: SessionScope) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_exclusive_in(&mut tx, scope).await?;
        if account.state == AccountState::Connected {
            end_consent_in(
                &mut tx,
                account.id,
                AccountState::LoggedOut,
                "authorization_ended",
            )
            .await?;
        }
        tx.commit().await.map_err(failure)
    }

    async fn update_groups(
        &self,
        scope: SessionScope,
        groups: &[GroupInfo],
        complete: bool,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_exclusive_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(());
        }
        groups::store_groups_in(&mut tx, &account, groups, complete).await?;
        tx.commit().await.map_err(failure)
    }

    async fn group_left(
        &self,
        scope: SessionScope,
        group: &str,
        observed_at: chrono::DateTime<chrono::Utc>,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_exclusive_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(());
        }
        groups::group_left_in(&mut tx, &account, group, observed_at).await?;
        tx.commit().await.map_err(failure)
    }

    async fn observed_groups(&self, scope: SessionScope) -> ExternalChatResult<Vec<String>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let groups = sqlx::query_scalar!(
            r#"SELECT DISTINCT b.remote_id FROM external_chat b JOIN whatsapp_chat_membership m ON m.chat_id = b.id
            WHERE m.account_id = $1 AND m.generation = $2 AND m.consent_ended_at IS NULL AND b.state = 'active'
              AND external_chat_can_view(b.id, $3)
            ORDER BY b.remote_id"#,
            account.id,
            account.generation,
            account.user_id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(if account.state == AccountState::Connected {
            groups
        } else {
            vec![]
        })
    }

    async fn update_chats(
        &self,
        scope: SessionScope,
        chats: &[ChatUpdate],
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(());
        }
        chats::update_chats_in(&mut tx, &account, chats).await?;
        tx.commit().await.map_err(failure)
    }

    async fn backfill_work(&self, scope: SessionScope) -> ExternalChatResult<Vec<BackfillWork>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(vec![]);
        }
        let work = chats::backfill_work_in(&mut tx, &account).await?;
        tx.commit().await.map_err(failure)?;
        Ok(work)
    }

    async fn backfill_waiting_for_message(
        &self,
        scope: SessionScope,
        group: Uuid,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        chats::set_backfill_in(
            &mut tx,
            &account,
            group,
            BackfillState::WaitingForMessage,
            false,
        )
        .await?;
        tx.commit().await.map_err(failure)
    }

    async fn pending_lookups(&self, scope: SessionScope) -> ExternalChatResult<Vec<LookupWork>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(vec![]);
        }
        let work = lookups::pending_lookups_in(&mut tx, &account).await?;
        tx.commit().await.map_err(failure)?;
        Ok(work)
    }

    async fn complete_lookup(
        &self,
        scope: SessionScope,
        lookup: Uuid,
        answer: &LookupAnswer,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(());
        }
        lookups::complete_lookup_in(&mut tx, &account, lookup, answer).await?;
        tx.commit().await.map_err(failure)
    }

    async fn backfill_requested(&self, scope: SessionScope, group: Uuid) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        chats::set_backfill_in(&mut tx, &account, group, BackfillState::Running, true).await?;
        tx.commit().await.map_err(failure)
    }

    async fn backfill_unanswered(
        &self,
        scope: SessionScope,
        group: Uuid,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        chats::set_backfill_in(
            &mut tx,
            &account,
            group,
            BackfillState::WaitingForPhone,
            false,
        )
        .await?;
        tx.commit().await.map_err(failure)
    }

    async fn backfill_page(
        &self,
        scope: SessionScope,
        page: &HistoryPage,
    ) -> ExternalChatResult<Vec<(Uuid, BackfillState)>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let states = chats::backfill_page_in(&mut tx, &account, page).await?;
        tx.commit().await.map_err(failure)?;
        Ok(states)
    }

    async fn ingest(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<IngestOutcome> {
        self.ingest_event(scope, event).await
    }

    async fn due_events(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<InboundEvent>> {
        PgWhatsAppRepository::due_events(self, scope, limit).await
    }

    async fn claim_sends(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<ClaimedSend>> {
        PgWhatsAppRepository::claim_sends(self, scope, limit).await
    }

    async fn begin_dispatch(
        &self,
        scope: SessionScope,
        send: Uuid,
        source_id: &str,
    ) -> ExternalChatResult<()> {
        PgWhatsAppRepository::begin_dispatch(self, scope, send, source_id).await
    }

    async fn record_send_outcome(
        &self,
        scope: SessionScope,
        send: Uuid,
        outcome: &SendOutcome,
    ) -> ExternalChatResult<()> {
        PgWhatsAppRepository::record_send_outcome(self, scope, send, outcome).await
    }
}
