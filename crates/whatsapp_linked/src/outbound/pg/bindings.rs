//! Adopted WhatsApp group entities and their lifecycle.
use super::*;
use crate::domain::ports::{Adopted, AdoptionRecord, BindingRepository};
use async_trait::async_trait;
use chrono::Utc;
use model_entity::EntityType;
use model_owner::Owner;
pub(super) struct BindingRow {
    pub id: Uuid,
    pub group_jid: String,
    pub user_id: String,
    pub state: String,
    pub ownership_state: String,
    pub adopted_at: chrono::DateTime<Utc>,
}

pub(super) fn binding(row: BindingRow) -> LinkedResult<Binding> {
    Ok(Binding {
        id: row.id,
        group_jid: row.group_jid,
        user_id: row.user_id,
        state: match row.state.as_str() {
            "active" => BindingState::Active,
            "suspended" => BindingState::Suspended,
            "detached" => BindingState::Detached,
            _ => return Err(LinkedError::Unavailable.into()),
        },
        ownership_state: match row.ownership_state.as_str() {
            "active" => OwnershipState::Active,
            "transfer_required" => OwnershipState::TransferRequired,
            _ => return Err(LinkedError::Unavailable.into()),
        },
        adopted_at: row.adopted_at,
    })
}

#[async_trait]
impl BindingRepository for PgLinkedRepository {
    async fn binding(&self, group: Uuid) -> LinkedResult<Option<Binding>> {
        sqlx::query_as!(BindingRow, "SELECT id, group_jid, user_id, state, ownership_state, adopted_at FROM whatsapp_group WHERE id = $1", group)
            .fetch_optional(&self.pool).await.map_err(failure)?.map(binding).transpose()
    }
    async fn adopt(&self, record: AdoptionRecord<'_>) -> LinkedResult<Adopted> {
        let AdoptionRecord {
            user,
            account,
            name,
            group,
        } = record;
        let identity = account
            .identity_jid
            .as_deref()
            .ok_or(LinkedError::Forbidden)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-group:' || $1 || ':' || $2, 0))",
            user,
            group.jid
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query_scalar!("SELECT id FROM whatsapp_linked_account WHERE id = $1 AND user_id = $2 AND generation = $3 AND state = 'connected' FOR SHARE", account.id,user,account.authorization_generation)
            .fetch_optional(&mut *tx).await.map_err(failure)?.ok_or(LinkedError::Disconnected)?;
        let existing = sqlx::query_as!(BindingRow,"SELECT id, group_jid, user_id, state, ownership_state, adopted_at FROM whatsapp_group WHERE user_id = $1 AND group_jid = $2 AND state <> 'detached' FOR UPDATE",user,group.jid)
            .fetch_optional(&mut *tx).await.map_err(failure)?;
        let adopted = match existing {
            Some(row) => Adopted {
                binding: binding(row)?,
                created: false,
            },
            None => {
                let id = Uuid::now_v7();
                let permission = Uuid::now_v7().to_string();
                share_permission_db_utils::insert_private_permission(&mut *tx, &permission)
                    .await
                    .map_err(failure)?;
                let row = sqlx::query_as!(BindingRow,"INSERT INTO whatsapp_group (id, group_jid, name, user_id, state, share_permission_id, backfill_state) VALUES ($1,$2,$3,$4,'active',$5,'pending') RETURNING id, group_jid, user_id, state, ownership_state, adopted_at",id,group.jid,name,user,permission)
                    .fetch_one(&mut *tx).await.map_err(failure)?;
                let owner = Owner::from_principal_str(user).map_err(failure)?;
                entity_registry_db_utils::insert_entity(
                    &mut tx,
                    entity_registry_db_utils::NewEntityRecord::try_new(
                        id,
                        EntityType::WhatsAppGroup,
                        owner.clone(),
                    )
                    .map_err(failure)?,
                )
                .await
                .map_err(helper_failure)?;
                entity_access_db_utils::upsert_owner_grant(
                    &mut tx,
                    &id,
                    EntityType::WhatsAppGroup,
                    &owner,
                )
                .await
                .map_err(failure)?;
                Adopted {
                    binding: binding(row)?,
                    created: true,
                }
            }
        };
        sqlx::query!(r#"INSERT INTO whatsapp_group_membership (binding_id,account_id,generation,consent_at,remote_member,can_post,observed_at,reconciled)
            VALUES ($1,$2,$3,clock_timestamp(),true,$4,$5,true)
            ON CONFLICT (binding_id,account_id) DO UPDATE SET generation = excluded.generation,consent_ended_at = NULL,
            remote_member = true,can_post = excluded.can_post,observed_at = excluded.observed_at,reconciled = true"#,
            adopted.binding.id,account.id,account.authorization_generation,group.can_post(identity),group.observed_at)
            .execute(&mut *tx).await.map_err(failure)?;
        notify(&mut tx, signals::ACCOUNT_CHANGED, account.id).await?;
        tx.commit().await.map_err(failure)?;
        Ok(adopted)
    }
    async fn message_attachments(
        &self,
        binding: &Binding,
        messages: &[Uuid],
    ) -> LinkedResult<Vec<MessageAttachments>> {
        let rows = sqlx::query!(
            r#"SELECT m.message_id AS "message_id!", a.ordinal, a.state, a.filename, a.mime, a.size, a.document_id,
                a.width, a.height, a.duration_seconds, a.presentation
            FROM whatsapp_group_attachment a
            JOIN whatsapp_group_message m ON m.binding_id = a.binding_id AND m.person_id = a.person_id AND m.source_id = a.source_id
            WHERE a.binding_id = $1 AND m.message_id = ANY($2) AND a.state <> 'deleted'
            ORDER BY m.message_id, a.ordinal"#,
            binding.id,
            messages
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        let mut result: Vec<MessageAttachments> = vec![];
        for row in rows {
            let mime = row.mime.unwrap_or_default();
            let state = match row.state.as_str() {
                "ready" => AttachmentState::Ready,
                "failed" if MediaKind::of(&mime).is_none() => AttachmentState::Unsupported,
                "failed" => AttachmentState::Unavailable,
                _ => AttachmentState::Loading,
            };
            let attachment = LinkedAttachment {
                ordinal: row.ordinal,
                state,
                file_name: row.filename.unwrap_or_default(),
                mime,
                size: row.size.unwrap_or(0).max(0) as u64,
                document_id: (state == AttachmentState::Ready).then_some(row.document_id),
                width: row.width.map(|value| value.max(0) as u32),
                height: row.height.map(|value| value.max(0) as u32),
                duration_seconds: row.duration_seconds.map(|value| value.max(0) as u32),
                presentation: row
                    .presentation
                    .as_deref()
                    .and_then(MediaPresentation::parse),
            };
            match result.last_mut() {
                Some(last) if last.message_id == row.message_id => {
                    last.linked_attachments.push(attachment)
                }
                _ => result.push(MessageAttachments {
                    message_id: row.message_id,
                    linked_attachments: vec![attachment],
                }),
            }
        }
        Ok(result)
    }

    async fn detach(&self, binding: &Binding) -> LinkedResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "UPDATE whatsapp_group SET state = 'detached', deleted_at = COALESCE(deleted_at,now()) WHERE id = $1",
            binding.id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        let observers = sqlx::query_scalar!(
            "UPDATE whatsapp_group_membership SET consent_ended_at = COALESCE(consent_ended_at, now()) WHERE binding_id = $1 RETURNING account_id",
            binding.id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            "UPDATE whatsapp_send SET state = 'failed', error_code = 'group_detached', claimed_epoch = NULL, updated_at = now() WHERE binding_id = $1 AND dispatch_started_at IS NULL AND state IN ('pending', 'sending')",
            binding.id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        for account in observers {
            notify(&mut tx, signals::ACCOUNT_CHANGED, account).await?;
        }
        notify_change(
            &mut tx,
            signals::Change::Group {
                group_id: binding.id,
            },
        )
        .await?;
        tx.commit().await.map_err(failure)
    }
}
