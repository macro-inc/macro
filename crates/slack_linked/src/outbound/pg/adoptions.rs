//! Adding Slack conversations as external chat entities, and detaching them.

use super::*;
use crate::domain::ports::{Adopted, AdoptionRecord, AdoptionRepository};
use async_trait::async_trait;
use model_entity::EntityType;
use model_owner::Owner;

#[async_trait]
impl AdoptionRepository for PgSlackRepository {
    async fn adopt(&self, record: AdoptionRecord<'_>) -> ExternalChatResult<Adopted> {
        let AdoptionRecord {
            user,
            conversation_id,
            kind,
            name,
            accounts,
        } = record;
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended('external-chat:slack:' || $1 || ':' || $2, 0))",
            user,
            conversation_id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        // Accounts first, in id order, like every session-service write.
        let mut observers = Vec::with_capacity(accounts.len());
        let mut ordered = accounts.to_vec();
        ordered.sort();
        for (account, generation) in ordered {
            let live = sqlx::query_scalar!(
                "SELECT id FROM slack_account WHERE id = $1 AND user_id = $2 AND generation = $3 AND state IN ('connecting', 'connected') FOR SHARE",
                account,
                user,
                generation
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(failure)?;
            if live.is_some() {
                observers.push((account, generation));
            }
        }
        if observers.is_empty() {
            return Err(ExternalChatError::Disconnected.into());
        }
        let existing = sqlx::query_as!(
            ChatRow,
            "SELECT id, provider, remote_id, kind, user_id, state, adopted_at FROM external_chat WHERE user_id = $1 AND provider = 'slack' AND remote_id = $2 AND state <> 'detached' FOR UPDATE",
            user,
            conversation_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        let adopted = match existing {
            Some(row) => Adopted {
                chat: chat_ref(row)?,
                created: false,
            },
            None => {
                let id = Uuid::now_v7();
                let permission = Uuid::now_v7().to_string();
                share_permission_db_utils::insert_private_permission(&mut *tx, &permission)
                    .await
                    .map_err(failure)?;
                // Recent history is imported right away; Slack needs no phone.
                let row = sqlx::query_as!(
                    ChatRow,
                    r#"INSERT INTO external_chat (id, provider, remote_id, kind, name, user_id, state, share_permission_id,
                        backfill_state, backfill_requested_at)
                    VALUES ($1, 'slack', $2, $3, $4, $5, 'active', $6, 'pending', now())
                    RETURNING id, provider, remote_id, kind, user_id, state, adopted_at"#,
                    id,
                    conversation_id,
                    kind.as_ref(),
                    name,
                    user,
                    permission
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(failure)?;
                let owner = Owner::from_principal_str(user).map_err(failure)?;
                entity_registry_db_utils::insert_entity(
                    &mut tx,
                    entity_registry_db_utils::NewEntityRecord::try_new(
                        id,
                        EntityType::ExternalChat,
                        owner.clone(),
                    )
                    .map_err(failure)?,
                )
                .await
                .map_err(helper_failure)?;
                entity_access_db_utils::upsert_owner_grant(
                    &mut tx,
                    &id,
                    EntityType::ExternalChat,
                    &owner,
                )
                .await
                .map_err(failure)?;
                Adopted {
                    chat: chat_ref(row)?,
                    created: true,
                }
            }
        };
        for (account, generation) in &observers {
            sqlx::query!(
                r#"INSERT INTO slack_chat_membership (chat_id, account_id, generation, consent_at, observed_at)
                VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())
                ON CONFLICT (chat_id, account_id) DO UPDATE SET generation = excluded.generation,
                    consent_at = CASE WHEN slack_chat_membership.consent_ended_at IS NULL
                        THEN slack_chat_membership.consent_at ELSE excluded.consent_at END,
                    consent_ended_at = NULL, remote_member = true, can_post = true"#,
                adopted.chat.id,
                account,
                generation
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
            notify(&mut tx, signals::ACCOUNT_CHANGED, *account).await?;
            if adopted.created {
                notify(&mut tx, signals::HISTORY_REQUESTED, *account).await?;
            }
            notify_change(
                &mut tx,
                Change::Chats {
                    provider: ExternalChatProvider::Slack,
                    account_id: *account,
                },
            )
            .await?;
        }
        tx.commit().await.map_err(failure)?;
        Ok(adopted)
    }

    async fn detach(&self, chat: &ChatRef) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "UPDATE external_chat SET state = 'detached' WHERE id = $1",
            chat.id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        let observers = sqlx::query_scalar!(
            "UPDATE slack_chat_membership SET consent_ended_at = COALESCE(consent_ended_at, now()) WHERE chat_id = $1 RETURNING account_id",
            chat.id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            "UPDATE slack_send SET state = 'failed', error_code = 'chat_detached', claimed_epoch = NULL, updated_at = now() WHERE chat_id = $1 AND dispatch_started_at IS NULL AND state IN ('pending', 'sending')",
            chat.id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!("DELETE FROM slack_read_mark WHERE chat_id = $1", chat.id)
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        for account in observers {
            notify(&mut tx, signals::ACCOUNT_CHANGED, account).await?;
            notify_change(
                &mut tx,
                Change::Chats {
                    provider: ExternalChatProvider::Slack,
                    account_id: account,
                },
            )
            .await?;
        }
        notify_change(&mut tx, Change::Chat { chat_id: chat.id }).await?;
        tx.commit().await.map_err(failure)
    }
}
