//! Queries over standalone WhatsApp entities, messages and read cursors.
use super::*;
use crate::domain::{ports::BindingRepository, timeline::*};
use async_trait::async_trait;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2, access_level::AccessLevel,
};

#[async_trait]
impl TimelineRepository for PgLinkedRepository {
    async fn visible_groups(&self, user: &str) -> LinkedResult<Vec<VisibleGroup>> {
        let rows = sqlx::query!(r#"SELECT g.id,g.name,g.user_id,g.group_jid,g.state,g.ownership_state,g.adopted_at,
            (SELECT count(*) FROM whatsapp_group_message m WHERE m.binding_id=g.id AND m.message_id IS NOT NULL
              AND m.deleted_at IS NULL AND m.origin<>'history'
              AND NOT EXISTS(SELECT 1 FROM whatsapp_external_person p WHERE p.id=m.person_id AND p.user_id=$1)
              AND (r.message_id IS NULL OR (m.source_at,m.id)>(r.read_at,r.message_id))) AS "unread_count!",
            (SELECT max(source_at) FROM whatsapp_group_message WHERE binding_id=g.id AND message_id IS NOT NULL) AS last_message_at,
            roster.metadata AS "metadata?"
            FROM whatsapp_group g
            LEFT JOIN whatsapp_group_read_state r ON r.group_id=g.id AND r.user_id=$1
            LEFT JOIN whatsapp_linked_account a ON a.user_id=$1
            LEFT JOIN whatsapp_group_roster roster ON roster.account_id=a.id AND roster.group_jid=g.group_jid
            WHERE whatsapp_group_can_view(g.id,$1)
              AND (r.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM entity_access ea
                WHERE ea.entity_id=g.id AND ea.entity_type='whatsapp_group'
                  AND (ea.source_id=$1 OR ea.source_id IN (SELECT team_id::text FROM team_user WHERE user_id=$1)
                    OR ea.source_id IN (SELECT channel_id::text FROM comms_channel_participants WHERE user_id=$1 AND left_at IS NULL))))
            ORDER BY g.adopted_at DESC LIMIT 2000"#,user)
            .fetch_all(&self.pool).await.map_err(failure)?;
        rows.into_iter()
            .map(|row| {
                Ok(VisibleGroup {
                    summary: WhatsAppGroupSummary {
                        id: row.id,
                        name: row.name,
                        user_id: row.user_id.clone(),
                        unread_count: row.unread_count,
                        last_message_at: row.last_message_at,
                        can_send: false,
                        send_reason: None,
                    },
                    binding: bindings::binding(bindings::BindingRow {
                        id: row.id,
                        group_jid: row.group_jid,
                        user_id: row.user_id,
                        state: row.state,
                        ownership_state: row.ownership_state,
                        adopted_at: row.adopted_at,
                    })?,
                    roster: row.metadata.map(decode).transpose()?,
                })
            })
            .collect()
    }
    async fn summary(&self, group: Uuid, user: &str) -> LinkedResult<WhatsAppGroupSummary> {
        let row = sqlx::query!(r#"SELECT g.id,g.name,g.user_id,
            (SELECT count(*) FROM whatsapp_group_message m WHERE m.binding_id = g.id AND m.message_id IS NOT NULL
              AND m.deleted_at IS NULL AND m.origin <> 'history'
              AND NOT EXISTS (SELECT 1 FROM whatsapp_external_person p WHERE p.id = m.person_id AND p.user_id = $2)
              AND (r.message_id IS NULL OR (m.source_at,m.id) > (r.read_at,r.message_id))) AS "unread_count!",
            (SELECT max(source_at) FROM whatsapp_group_message WHERE binding_id = g.id AND message_id IS NOT NULL) AS last_message_at
            FROM whatsapp_group g LEFT JOIN whatsapp_group_read_state r ON r.group_id = g.id AND r.user_id = $2
            WHERE g.id = $1"#,group,user).fetch_optional(&self.pool).await.map_err(failure)?.ok_or(LinkedError::NotFound)?;
        Ok(WhatsAppGroupSummary {
            id: row.id,
            name: row.name,
            user_id: row.user_id,
            unread_count: row.unread_count,
            last_message_at: row.last_message_at,
            can_send: false,
            send_reason: None,
        })
    }
    async fn messages(
        &self,
        group: Uuid,
        user: &str,
        before: Option<Uuid>,
        limit: i64,
    ) -> LinkedResult<WhatsAppGroupMessages> {
        let rows = sqlx::query!(r#"SELECT m.id,m.person_id,p.user_id,COALESCE(p.display_name,'WhatsApp participant') AS "name!",
            m.body,m.reply_to,m.source_at,m.ingested_at,m.revised_at,m.deleted_at,
            (SELECT state FROM whatsapp_send s WHERE s.message_id = m.id AND s.user_id = $2 ORDER BY s.created_at DESC LIMIT 1) AS delivery
            FROM whatsapp_group_message m JOIN whatsapp_external_person p ON p.id = m.person_id
            WHERE m.binding_id = $1 AND m.message_id IS NOT NULL
              AND ($3::uuid IS NULL OR (m.source_at,m.id) < (SELECT source_at,id FROM whatsapp_group_message WHERE id = $3 AND binding_id = $1 AND message_id IS NOT NULL))
            ORDER BY m.source_at DESC,m.id DESC LIMIT $4"#,group,user,before,limit+1)
            .fetch_all(&self.pool).await.map_err(failure)?;
        let more = rows.len() > limit as usize;
        let mut messages = Vec::with_capacity(rows.len());
        let binding = self.binding(group).await?.ok_or(LinkedError::NotFound)?;
        let ids: Vec<_> = rows.iter().take(limit as usize).map(|r| r.id).collect();
        let attachments = self.message_attachments(&binding, &ids).await?;
        let reactions=sqlx::query!(r#"SELECT message_id,emoji,count(*) AS "count!",COALESCE(bool_or(user_id=$2),false) AS "mine!"
            FROM whatsapp_group_reaction WHERE message_id=ANY($1) AND emoji<>'' GROUP BY message_id,emoji ORDER BY message_id,emoji"#,&ids,user)
            .fetch_all(&self.pool).await.map_err(failure)?;
        for row in rows.into_iter().take(limit as usize) {
            let grouped = reactions
                .iter()
                .filter(|r| r.message_id == row.id)
                .map(|r| WhatsAppGroupReaction {
                    emoji: r.emoji.clone(),
                    count: r.count,
                    mine: r.mine,
                })
                .collect();
            messages.push(WhatsAppGroupMessage {
                id: row.id,
                sender: WhatsAppGroupSender {
                    person_id: row.person_id,
                    user_id: row.user_id,
                    name: row.name,
                },
                body: if row.deleted_at.is_some() {
                    String::new()
                } else {
                    row.body
                },
                reply_to: row.reply_to,
                sent_at: row.source_at,
                received_at: row.ingested_at,
                edited_at: row.revised_at,
                deleted: row.deleted_at.is_some(),
                reactions: grouped,
                attachments: attachments
                    .iter()
                    .find(|a| a.message_id == row.id)
                    .map(|a| a.linked_attachments.clone())
                    .unwrap_or_default(),
                delivery_state: row.delivery.as_deref().and_then(DeliveryState::parse),
            });
        }
        let next_cursor = more.then(|| messages.last().map(|m| m.id)).flatten();
        Ok(WhatsAppGroupMessages {
            messages,
            next_cursor,
        })
    }
    async fn mark_read(&self, group: Uuid, user: &str, message: Uuid) -> LinkedResult<()> {
        let changed = sqlx::query!(r#"INSERT INTO whatsapp_group_read_state (user_id,group_id,message_id,read_at)
            SELECT $2,$1,id,source_at FROM whatsapp_group_message WHERE id = $3 AND binding_id = $1 AND message_id IS NOT NULL
            ON CONFLICT (user_id,group_id) DO UPDATE SET message_id = excluded.message_id,read_at = excluded.read_at
            WHERE (whatsapp_group_read_state.read_at,whatsapp_group_read_state.message_id) < (excluded.read_at,excluded.message_id)"#,group,user,message)
            .execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() == 0 {
            let exists=sqlx::query_scalar!("SELECT id FROM whatsapp_group_message WHERE id=$1 AND binding_id=$2 AND message_id IS NOT NULL",message,group).fetch_optional(&self.pool).await.map_err(failure)?;
            if exists.is_none() {
                return Err(LinkedError::NotFound.into());
            }
        }
        Ok(())
    }
    async fn permissions(&self, group: Uuid) -> LinkedResult<SharePermissionV2> {
        let r=sqlx::query!(r#"SELECT sp.id,sp."linkShare" AS "link_share: LinkShare",sp."linkShareAccessLevel" AS "link_level: AccessLevel",
            sp.team_share_access_level AS "team_level: AccessLevel",g.user_id FROM whatsapp_group g JOIN "SharePermission" sp ON sp.id=g.share_permission_id WHERE g.id=$1"#,group)
            .fetch_optional(&self.pool).await.map_err(failure)?.ok_or(LinkedError::NotFound)?;
        Ok(SharePermissionV2 {
            id: r.id,
            link_share: r.link_share,
            link_share_access_level: r.link_level,
            team_share_access_level: r.team_level,
            owner: r.user_id,
            channel_share_permissions: None,
        })
    }
    async fn share_facts(
        &self,
        group: Uuid,
    ) -> LinkedResult<models_permissions::share_permission::team_share::TeamShareFacts> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let result = share_permission_db_utils::team_share::load_facts(
            &mut tx,
            &model_entity::EntityType::WhatsAppGroup.with_entity_string(group.to_string()),
        )
        .await
        .map_err(helper_failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(result)
    }
    async fn update_permissions(
        &self,
        group: Uuid,
        user: &str,
        update: &UpdateSharePermissionRequestV2,
        command: Option<
            &models_permissions::share_permission::team_share::AuthorizedTeamShareCommand,
        >,
    ) -> LinkedResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        share_permission_db_utils::team_share::acquire_guard(&mut tx)
            .await
            .map_err(failure)?;
        let permission = sqlx::query_scalar!(
            "SELECT share_permission_id FROM whatsapp_group WHERE id=$1 AND user_id=$2 FOR UPDATE",
            group,
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(LinkedError::Forbidden)?;
        if let Some(command) = command {
            share_permission_db_utils::team_share::apply(&mut tx, command)
                .await
                .map_err(helper_failure)?;
        }
        share_permission_db_utils::update_link_share(&mut *tx, &permission, update)
            .await
            .map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
}
