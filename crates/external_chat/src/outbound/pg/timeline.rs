//! Queries over external chat entities, messages and read cursors.
use super::*;
use crate::domain::{
    ports::ChatRepository,
    rich::RichContent,
    timeline::{view::StoredVote, *},
};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2, access_level::AccessLevel,
};

fn backfill(state: Option<&str>, imported: i32) -> Option<Backfill> {
    Some(Backfill {
        state: BackfillState::parse(state?)?,
        imported: imported.max(0) as u32,
    })
}

impl PgExternalChatRepository {
    /// A newest-first page of the timeline, or only the message `only`.
    async fn timeline_page(
        &self,
        chat: &ChatRef,
        user: &str,
        before: Option<Uuid>,
        only: Option<Uuid>,
        limit: i64,
    ) -> ExternalChatResult<StoredPage> {
        let rows = sqlx::query!(r#"SELECT m.id,m.person_id,p.user_id,COALESCE(p.display_name,'WhatsApp participant') AS "name!",
            m.body,m.reply_to,m.source_at,m.ingested_at,m.revised_at,m.deleted_at,m.kind,m.rich,m.mentions,m.forwarded,m.view_once
            FROM external_chat_message m JOIN external_chat_person p ON p.id = m.person_id
            WHERE m.chat_id = $1 AND m.message_id IS NOT NULL
              AND ($2::uuid IS NULL OR (m.source_at,m.id) < (SELECT source_at,id FROM external_chat_message WHERE id = $2 AND chat_id = $1 AND message_id IS NOT NULL))
              AND ($4::uuid IS NULL OR m.id = $4)
            ORDER BY m.source_at DESC,m.id DESC LIMIT $3"#,chat.id,before,limit+1,only)
            .fetch_all(&self.pool).await.map_err(failure)?;
        let more = rows.len() > limit as usize;
        let ids: Vec<_> = rows.iter().take(limit as usize).map(|r| r.id).collect();
        let attachments = self.message_attachments(chat, &ids).await?;
        let mut rich = Vec::with_capacity(ids.len());
        for row in rows.iter().take(limit as usize) {
            let content: Option<RichContent> = match (&row.deleted_at, &row.rich) {
                (None, Some(value)) => Some(decode(value.clone())?),
                _ => None,
            };
            rich.push(content);
        }
        let polls: Vec<Uuid> = rows
            .iter()
            .zip(&rich)
            .filter(|(_, content)| matches!(content, Some(RichContent::Poll(_))))
            .map(|(row, _)| row.id)
            .collect();
        let votes: Vec<StoredVote> = sqlx::query!(
            r#"SELECT v.message_id, v.selected, p.user_id, COALESCE(p.display_name, 'WhatsApp participant') AS "name!"
            FROM external_chat_poll_vote v JOIN external_chat_person p ON p.id = v.person_id
            WHERE v.message_id = ANY($1) AND cardinality(v.selected) > 0
            ORDER BY v.updated_at"#,
            &polls
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| StoredVote {
            message_id: row.message_id,
            selected: row.selected,
            voter: ExternalChatPersonRef {
                name: row.name,
                user_id: row.user_id,
            },
        })
        .collect();
        let reactions=sqlx::query!(r#"SELECT message_id,emoji,count(*) AS "count!",COALESCE(bool_or(user_id=$2),false) AS "mine!"
            FROM external_chat_reaction WHERE message_id=ANY($1) AND emoji<>'' GROUP BY message_id,emoji ORDER BY message_id,emoji"#,&ids,user)
            .fetch_all(&self.pool).await.map_err(failure)?;
        let mut messages = Vec::with_capacity(ids.len());
        for (row, content) in rows.into_iter().take(limit as usize).zip(rich) {
            let deleted = row.deleted_at.is_some();
            messages.push(StoredMessage {
                id: row.id,
                sender: ExternalChatSender {
                    person_id: row.person_id,
                    user_id: row.user_id,
                    name: row.name,
                },
                body: if deleted { String::new() } else { row.body },
                reply_to: row.reply_to,
                sent_at: row.source_at,
                received_at: row.ingested_at,
                edited_at: row.revised_at,
                deleted,
                reactions: reactions
                    .iter()
                    .filter(|r| r.message_id == row.id)
                    .map(|r| ExternalChatReaction {
                        emoji: r.emoji.clone(),
                        count: r.count,
                        mine: r.mine,
                    })
                    .collect(),
                attachments: attachments
                    .iter()
                    .find(|a| a.message_id == row.id)
                    .map(|a| a.attachments.clone())
                    .unwrap_or_default(),
                kind: if row.kind == "system" {
                    ExternalChatMessageKind::System
                } else {
                    ExternalChatMessageKind::Message
                },
                forwarded: row.forwarded,
                view_once: row.view_once,
                mentions: if deleted { vec![] } else { row.mentions },
                rich: content,
                votes: votes
                    .iter()
                    .filter(|vote| vote.message_id == row.id)
                    .cloned()
                    .collect(),
            });
        }
        let next_cursor = more.then(|| messages.last().map(|m| m.id)).flatten();
        Ok(StoredPage {
            messages,
            next_cursor,
        })
    }

    /// The chats `user` can see (or just `only`, already authorized).
    /// Candidates come from the viewer's grants and read cursors before the
    /// visibility check, so a viewer who sees few chats never scans every chat.
    async fn chat_rows(
        &self,
        user: &str,
        only: Option<Uuid>,
    ) -> ExternalChatResult<Vec<VisibleChat>> {
        let rows = sqlx::query!(r#"WITH sources AS MATERIALIZED (
                SELECT array_append(ARRAY(SELECT team_id::text FROM team_user WHERE user_id = $1)
                    || ARRAY(SELECT channel_id::text FROM comms_channel_participants WHERE user_id = $1 AND left_at IS NULL), $1) AS ids),
            candidates AS MATERIALIZED (
                SELECT $2::uuid AS id WHERE $2::uuid IS NOT NULL
                UNION
                SELECT ea.entity_id FROM entity_access ea, sources s
                WHERE $2::uuid IS NULL AND ea.entity_type = 'external_chat' AND ea.source_id = ANY(s.ids)
                UNION
                SELECT rs.chat_id FROM external_chat_read_state rs WHERE $2::uuid IS NULL AND rs.user_id = $1)
            SELECT g.id,g.provider,g.name,g.kind,g.user_id,g.remote_id,g.state,g.adopted_at,g.backfill_state,g.backfill_imported,
            (SELECT count(*) FROM (SELECT 1 FROM external_chat_message m WHERE m.chat_id=g.id AND m.message_id IS NOT NULL
              AND m.deleted_at IS NULL AND m.origin<>'history' AND m.kind<>'system'
              AND NOT EXISTS(SELECT 1 FROM external_chat_person p WHERE p.id=m.person_id AND p.user_id=$1)
              AND (r.message_id IS NULL OR (m.source_at,m.id)>(r.read_at,r.message_id)) LIMIT $3) unread) AS "unread_count!",
            (SELECT max(source_at) FROM external_chat_message WHERE chat_id=g.id AND message_id IS NOT NULL) AS last_message_at
            FROM candidates c JOIN external_chat g ON g.id=c.id
            LEFT JOIN external_chat_read_state r ON r.chat_id=g.id AND r.user_id=$1
            -- On the candidate, not the chat: Postgres would otherwise check every chat.
            WHERE ($2::uuid IS NOT NULL OR external_chat_can_view(c.id,$1))
            ORDER BY g.adopted_at DESC LIMIT 2000"#,user,only,UNREAD_COUNT_CAP)
            .fetch_all(&self.pool).await.map_err(failure)?;
        rows.into_iter()
            .map(|row| {
                let chat = chat_ref(ChatRow {
                    id: row.id,
                    provider: row.provider,
                    remote_id: row.remote_id,
                    kind: row.kind,
                    user_id: row.user_id.clone(),
                    state: row.state,
                    adopted_at: row.adopted_at,
                })?;
                Ok(VisibleChat {
                    facts: ChatFacts {
                        id: row.id,
                        provider: chat.provider,
                        name: row.name,
                        kind: chat.kind,
                        user_id: row.user_id,
                        unread_count: row.unread_count,
                        last_message_at: row.last_message_at,
                        backfill: backfill(row.backfill_state.as_deref(), row.backfill_imported),
                    },
                    chat,
                })
            })
            .collect()
    }
}

#[async_trait]
impl TimelineRepository for PgExternalChatRepository {
    async fn visible_chats(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<VisibleChat>> {
        let user = user.as_ref();
        self.chat_rows(user, None).await
    }
    async fn chat_facts(&self, chat: Uuid, user: &str) -> ExternalChatResult<ChatFacts> {
        self.chat_rows(user, Some(chat))
            .await?
            .pop()
            .map(|visible| visible.facts)
            .ok_or_else(|| ExternalChatError::NotFound.into())
    }
    async fn messages(
        &self,
        chat: &ChatRef,
        user: &str,
        before: Option<Uuid>,
        limit: i64,
    ) -> ExternalChatResult<StoredPage> {
        self.timeline_page(chat, user, before, None, limit).await
    }
    async fn message(
        &self,
        chat: &ChatRef,
        user: &str,
        message: Uuid,
    ) -> ExternalChatResult<Option<StoredMessage>> {
        Ok(self
            .timeline_page(chat, user, None, Some(message), 1)
            .await?
            .messages
            .pop())
    }
    async fn mark_read(
        &self,
        chat: Uuid,
        user: &MacroUserIdStr<'_>,
        message: Uuid,
    ) -> ExternalChatResult<()> {
        let user = user.as_ref();
        let changed = sqlx::query!(r#"INSERT INTO external_chat_read_state (user_id,chat_id,message_id,read_at)
            SELECT $2,$1,id,source_at FROM external_chat_message WHERE id = $3 AND chat_id = $1 AND message_id IS NOT NULL
            ON CONFLICT (user_id,chat_id) DO UPDATE SET message_id = excluded.message_id,read_at = excluded.read_at
            WHERE (external_chat_read_state.read_at,external_chat_read_state.message_id) < (excluded.read_at,excluded.message_id)"#,chat,user,message)
            .execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() == 0 {
            let exists=sqlx::query_scalar!("SELECT id FROM external_chat_message WHERE id=$1 AND chat_id=$2 AND message_id IS NOT NULL",message,chat).fetch_optional(&self.pool).await.map_err(failure)?;
            if exists.is_none() {
                return Err(ExternalChatError::NotFound.into());
            }
        }
        Ok(())
    }
    async fn permissions(&self, chat: Uuid) -> ExternalChatResult<SharePermissionV2> {
        let r=sqlx::query!(r#"SELECT sp.id,sp."linkShare" AS "link_share: LinkShare",sp."linkShareAccessLevel" AS "link_level: AccessLevel",
            sp.team_share_access_level AS "team_level: AccessLevel",g.user_id FROM external_chat g JOIN "SharePermission" sp ON sp.id=g.share_permission_id WHERE g.id=$1"#,chat)
            .fetch_optional(&self.pool).await.map_err(failure)?.ok_or(ExternalChatError::NotFound)?;
        let channels = entity_access_db_utils::get_direct_channel_grants(
            &self.pool,
            &chat,
            entity_access_db_utils::EntityType::ExternalChat,
        )
        .await
        .map_err(failure)?;
        Ok(SharePermissionV2 {
            id: r.id,
            link_share: r.link_share,
            link_share_access_level: r.link_level,
            team_share_access_level: r.team_level,
            owner: r.user_id,
            channel_share_permissions: Some(channels),
        })
    }
    async fn share_facts(
        &self,
        chat: Uuid,
    ) -> ExternalChatResult<models_permissions::share_permission::team_share::TeamShareFacts> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let result = share_permission_db_utils::team_share::load_facts(
            &mut tx,
            &model_entity::EntityType::ExternalChat.with_entity_string(chat.to_string()),
        )
        .await
        .map_err(helper_failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(result)
    }
    async fn update_permissions(
        &self,
        chat: Uuid,
        user: &MacroUserIdStr<'_>,
        update: &UpdateSharePermissionRequestV2,
        command: Option<
            &models_permissions::share_permission::team_share::AuthorizedTeamShareCommand,
        >,
    ) -> ExternalChatResult<()> {
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        share_permission_db_utils::team_share::acquire_guard(&mut tx)
            .await
            .map_err(failure)?;
        let permission = sqlx::query_scalar!(
            "SELECT share_permission_id FROM external_chat WHERE id=$1 AND user_id=$2 FOR UPDATE",
            chat,
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::Forbidden)?;
        if let Some(command) = command {
            share_permission_db_utils::team_share::apply(&mut tx, command)
                .await
                .map_err(helper_failure)?;
        }
        share_permission_db_utils::update_link_share(&mut *tx, &permission, update)
            .await
            .map_err(failure)?;
        if let Some(channels) = update
            .channel_share_permissions
            .as_deref()
            .filter(|channels| !channels.is_empty())
        {
            entity_access_db_utils::update_entity_access_channel_share_permissions(
                &mut tx,
                &chat,
                entity_access_db_utils::EntityType::ExternalChat,
                channels,
            )
            .await
            .map_err(failure)?;
        }
        tx.commit().await.map_err(failure)
    }
}
