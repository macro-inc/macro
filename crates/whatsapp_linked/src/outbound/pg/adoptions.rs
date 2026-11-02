//! Adding WhatsApp chats as external chat entities, and detaching them.
use super::*;
use crate::domain::ports::{Adopted, AdoptionRecord, AdoptionRepository};
use async_trait::async_trait;
use model_entity::EntityType;
use model_owner::Owner;
#[async_trait]
impl AdoptionRepository for PgWhatsAppRepository {
    async fn adopt(&self, record: AdoptionRecord<'_>) -> ExternalChatResult<Adopted> {
        let AdoptionRecord {
            user,
            account,
            adoption,
        } = record;
        let user = user.as_ref();
        account
            .identity_jid
            .as_deref()
            .ok_or(ExternalChatError::Forbidden)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended('external-chat:whatsapp:' || $1 || ':' || $2, 0))",
            user,
            adoption.jid
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query_scalar!("SELECT id FROM whatsapp_linked_account WHERE id = $1 AND user_id = $2 AND generation = $3 AND state = 'connected' FOR SHARE", account.id,user,account.authorization_generation)
            .fetch_optional(&mut *tx).await.map_err(failure)?.ok_or(ExternalChatError::Disconnected)?;
        let existing = sqlx::query_as!(ChatRow,"SELECT id, provider, remote_id, kind, user_id, state, adopted_at FROM external_chat WHERE user_id = $1 AND provider = 'whatsapp' AND remote_id = $2 AND state <> 'detached' FOR UPDATE",user,adoption.jid)
            .fetch_optional(&mut *tx).await.map_err(failure)?;
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
                // Importing starts from a message of the chat, when the owner asks
                // (it wakes their phone); with none known yet a group waits for
                // the first one, and a direct chat nobody wrote in (a saved
                // contact, a looked-up number) has nothing to import.
                let row = sqlx::query_as!(ChatRow,r#"INSERT INTO external_chat (id, provider, remote_id, kind, name, user_id, state, share_permission_id, backfill_state)
                    VALUES ($1,'whatsapp',$2,$3,$4,$5,'active',$6,
                        CASE WHEN EXISTS (SELECT 1 FROM whatsapp_chat WHERE account_id = $7 AND chat_jid = $2 AND anchor IS NOT NULL)
                            OR EXISTS (SELECT 1 FROM external_chat_message m JOIN external_chat g ON g.id = m.chat_id
                                WHERE g.provider = 'whatsapp' AND g.remote_id = $2 AND m.kind = 'message' AND m.message_id IS NOT NULL
                                  AND EXISTS (SELECT 1 FROM whatsapp_message_observation o WHERE o.chat_id = m.chat_id
                                      AND o.person_id = m.person_id AND o.source_id = m.source_id AND o.account_id = $7))
                        THEN 'waiting_for_phone' WHEN $3 = 'direct' THEN 'done' ELSE 'waiting_for_message' END)
                    RETURNING id, provider, remote_id, kind, user_id, state, adopted_at"#,id,adoption.jid,adoption.kind.as_ref(),adoption.name,user,permission,account.id)
                    .fetch_one(&mut *tx).await.map_err(failure)?;
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
        sqlx::query!(r#"INSERT INTO whatsapp_chat_membership (chat_id,account_id,generation,consent_at,remote_member,can_post,observed_at,reconciled)
            VALUES ($1,$2,$3,clock_timestamp(),true,$4,$5,true)
            ON CONFLICT (chat_id,account_id) DO UPDATE SET generation = excluded.generation,consent_ended_at = NULL,
            remote_member = true,can_post = excluded.can_post,observed_at = excluded.observed_at,reconciled = true"#,
            adopted.chat.id,account.id,account.authorization_generation,adoption.can_post,adoption.observed_at)
            .execute(&mut *tx).await.map_err(failure)?;
        notify(&mut tx, signals::ACCOUNT_CHANGED, account.id).await?;
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
            "UPDATE whatsapp_chat_membership SET consent_ended_at = COALESCE(consent_ended_at, now()) WHERE chat_id = $1 RETURNING account_id",
            chat.id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            "UPDATE whatsapp_send SET state = 'failed', error_code = 'chat_detached', claimed_epoch = NULL, updated_at = now() WHERE chat_id = $1 AND dispatch_started_at IS NULL AND state IN ('pending', 'sending')",
            chat.id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        for account in observers {
            notify(&mut tx, signals::ACCOUNT_CHANGED, account).await?;
        }
        notify_change(&mut tx, Change::Chat { chat_id: chat.id }).await?;
        tx.commit().await.map_err(failure)
    }
}
