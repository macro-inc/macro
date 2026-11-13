//! Who a reply suggestion's item waits on the person for: an email thread's
//! newest message through the email domain's repository, or a channel message
//! with its sender's name.

use email::domain::ports::EmailRepo;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use sqlx::PgPool;

use crate::domain::model::{Target, Waiting, sender_name};
use crate::domain::ports::ReplyWaits;

#[cfg(test)]
mod test;

/// [`ReplyWaits`] over email threads ([`EmailRepo`]) and channel messages.
pub struct ItemReplyWaits<R> {
    /// Reads email threads' messages and senders.
    pub email: R,
    /// Reads channel messages and their senders' names.
    pub pool: PgPool,
}

#[async_trait::async_trait]
impl<R> ReplyWaits for ItemReplyWaits<R>
where
    R: EmailRepo,
    R::Err: std::error::Error + Sync + 'static,
{
    async fn waiting(
        &self,
        user: &MacroUserIdStr<'_>,
        target: &Target,
    ) -> Result<Option<Waiting>, rootcause::Report> {
        match target.entity_type {
            EntityType::EmailThread => self
                .email_waiting(target)
                .await
                .map_err(|error| rootcause::Report::new(error).into_dynamic()),
            EntityType::Channel => self
                .channel_waiting(user, target)
                .await
                .map_err(|error| rootcause::Report::new(error).into_dynamic()),
            _ => Ok(None),
        }
    }
}

impl<R: EmailRepo> ItemReplyWaits<R> {
    /// The thread's newest message that isn't a draft, unless the person sent it.
    async fn email_waiting(&self, target: &Target) -> Result<Option<Waiting>, R::Err> {
        let Ok(thread) = Uuid::parse_str(&target.entity_id) else {
            return Ok(None);
        };
        let Some(latest) = self
            .email
            .latest_content_message_rows(&[thread])
            .await?
            .into_iter()
            .next()
            .filter(|message| !message.is_sent)
        else {
            return Ok(None);
        };
        let from = self
            .email
            .senders_by_message_ids(&[latest.db_id])
            .await?
            .remove(&latest.db_id)
            .and_then(|sender| sender.name)
            .as_deref()
            .and_then(sender_name);
        Ok(Some(Waiting {
            // The order the thread's messages sort in.
            since: latest
                .internal_date_ts
                .or(latest.sent_at)
                .unwrap_or(latest.created_at),
            from,
        }))
    }

    /// The channel message the target names, unless the person sent it.
    async fn channel_waiting(
        &self,
        user: &MacroUserIdStr<'_>,
        target: &Target,
    ) -> Result<Option<Waiting>, sqlx::Error> {
        let (Some(message), Ok(channel)) = (
            target
                .part_id
                .as_deref()
                .and_then(|part| Uuid::parse_str(part).ok()),
            Uuid::parse_str(&target.entity_id),
        ) else {
            return Ok(None);
        };
        let row = sqlx::query!(
            r#"SELECT m.sender_id, m.created_at,
                      i.first_name AS "first_name?", i.last_name AS "last_name?"
               FROM comms_messages m
               LEFT JOIN "User" u ON u.id = m.sender_id
               LEFT JOIN macro_user_info i ON i.macro_user_id = u.macro_user_id
               WHERE m.id = $1 AND m.parent_entity_type = 'channel'
                 AND m.parent_entity_id = $2 AND m.deleted_at IS NULL"#,
            message,
            channel.to_string(),
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row.filter(|row| row.sender_id != user.as_ref()) else {
            return Ok(None);
        };
        let name = [row.first_name, row.last_name]
            .into_iter()
            .flatten()
            .map(|part| part.trim().to_owned())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        Ok(Some(Waiting {
            since: row.created_at,
            from: sender_name(&name),
        }))
    }
}
