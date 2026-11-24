//! Hydrate a channel write in one message-scoped statement before sequencing.

use super::*;

impl PgMessageRepository {
    pub(super) async fn require_channel_message_in(
        tx: &mut Transaction<'_, Postgres>,
        channel_id: Uuid,
        id: Uuid,
    ) -> Result<Message, MessageError> {
        // Every aggregate starts from this one message's identity. This keeps
        // channel writes from holding their transaction through four separate
        // hydration roundtrips, without widening any related-table scan.
        let row = sqlx::query!(
            r#"
            SELECT to_jsonb(m) AS "message!: Json<StoredMessage>",
                   (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id), '[]')
                    FROM (
                        SELECT id, entity_type, entity_id, width, height, created_at
                        FROM comms_attachments WHERE message_id = m.id
                    ) a) AS "attachments!: Json<Vec<MessageAttachment>>",
                   (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.emoji), '[]')
                    FROM (
                        SELECT emoji, array_agg(user_id ORDER BY user_id) AS users
                        FROM comms_reactions WHERE message_id = m.id GROUP BY emoji
                    ) r) AS "reactions!: Json<Vec<CountedReaction>>",
                   (SELECT COALESCE(jsonb_agg(to_jsonb(mention) ORDER BY mention.entity_type, mention.entity_id), '[]')
                    FROM (
                        SELECT entity_type, entity_id FROM comms_entity_mentions
                        WHERE source_entity_type = 'message' AND source_entity_id = m.id::text
                    ) mention) AS "mentions!: Json<Vec<SimpleMention>>"
            FROM comms_messages m
            WHERE m.id = $1 AND m.parent_entity_type = 'channel' AND m.parent_entity_id = $2
            "#,
            id,
            channel_id.to_string(),
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(database_error)?
        .ok_or(MessageError::NotFound)?;

        let bot_profile = match row
            .message
            .sender_id
            .strip_prefix("bot|")
            .and_then(|id| id.parse::<Uuid>().ok())
        {
            Some(bot_id) => {
                let ids = [bot_id];
                sqlx::query!(
                    "SELECT id, name, avatar_url FROM bots WHERE id = ANY($1)",
                    &ids,
                )
                .fetch_optional(&mut **tx)
                .await
                .map_err(database_error)?
                .filter(|bot| format!("bot|{}", bot.id) == row.message.sender_id)
                .map(|bot| BotSenderProfile {
                    name: bot.name,
                    avatar_url: bot.avatar_url,
                })
            }
            None => None,
        };

        Self::assemble_message(
            row.message.0,
            row.attachments.0,
            row.reactions.0,
            row.mentions.0,
            bot_profile,
        )
    }

    /// The same projection for bulk reads and the optimized single write read.
    pub(super) fn assemble_message(
        row: StoredMessage,
        attachments: Vec<MessageAttachment>,
        reactions: Vec<CountedReaction>,
        mentions: Vec<SimpleMention>,
        bot_profile: Option<BotSenderProfile>,
    ) -> Result<Message, MessageError> {
        let deleted = row.deleted_at.is_some();
        Ok(Message {
            id: row.id,
            parent: MessageParent::parse(&row.parent_entity_type, &row.parent_entity_id)
                .map_err(|error| MessageError::Repository(rootcause::Report::new(error).into()))?,
            thread_id: row.thread_id,
            import_order: row.import_order,
            bot_profile: bot_profile.or_else(|| {
                let id = bot_id::BotIdStr::parse_from_str(&row.sender_id)
                    .ok()?
                    .bot_id();
                bot_id::system_bot(id).map(|bot| BotSenderProfile {
                    name: bot.name.to_owned(),
                    avatar_url: None,
                })
            }),
            mentions: if deleted { vec![] } else { mentions },
            sender_id: row
                .sender_id
                .try_into()
                .map_err(|error| MessageError::Repository(rootcause::Report::new(error).into()))?,
            imported_author: row.imported_author.map(|name| ImportedAuthor { name }),
            kind: row.kind,
            guest_name: row.guest_name,
            triggered_by: row.triggered_by_user_id,
            triggered_via: row.triggered_via,
            content: if deleted { String::new() } else { row.content },
            created_at: row.created_at,
            updated_at: row.updated_at,
            edited_at: row.edited_at.map(|date| date.and_utc()),
            deleted_at: row.deleted_at.map(|date| date.and_utc()),
            attachments: if deleted { vec![] } else { attachments },
            reactions: if deleted { vec![] } else { reactions },
        })
    }
}
