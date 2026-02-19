use crate::domain::{
    models::{ChannelMessage, ChannelParticipant, ThreadInfo, ThreadReply, TopLevelMessageRow},
    ports::{
        ChannelAttachmentsPage, ChannelMessagesErr, ChannelMessagesPage, ChannelMessagesRepo,
        ChannelMessagesService,
    },
};
use models_pagination::{CreatedAt, PaginateOn, Query};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Default number of preview replies per thread.
const THREAD_PREVIEW_COUNT: u16 = 3;

/// Service implementation backed by a [`ChannelMessagesRepo`].
pub struct ChannelMessagesServiceImpl<R> {
    repo: R,
}

impl<R> ChannelMessagesServiceImpl<R>
where
    R: ChannelMessagesRepo,
    anyhow::Error: From<R::Err>,
{
    /// Create a new service with the given repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    /// Hydrate top-level message rows with thread data, reactions, and attachments.
    async fn hydrate_messages(
        &self,
        rows: Vec<TopLevelMessageRow>,
    ) -> Result<Vec<ChannelMessage>, ChannelMessagesErr> {
        let parent_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();

        let thread_data = self
            .repo
            .get_thread_data(&parent_ids, THREAD_PREVIEW_COUNT)
            .await
            .map_err(anyhow::Error::from)?;

        let mut all_ids: Vec<Uuid> = parent_ids.clone();
        for td in thread_data.values() {
            for reply in &td.preview_replies {
                all_ids.push(reply.id);
            }
        }

        let (reactions, attachments) = tokio::join!(
            self.repo.get_reactions_batch(&all_ids),
            self.repo.get_attachments_batch(&all_ids),
        );

        let reactions = reactions.map_err(anyhow::Error::from)?;
        let attachments = attachments.map_err(anyhow::Error::from)?;

        let messages: Vec<ChannelMessage> = rows
            .into_iter()
            .map(|row| {
                let td = thread_data.get(&row.id);
                let preview_replies = td
                    .map(|td| {
                        td.preview_replies
                            .iter()
                            .map(|r| ThreadReply {
                                id: r.id,
                                sender_id: r.sender_id.clone(),
                                content: r.content.clone(),
                                created_at: r.created_at,
                                updated_at: r.updated_at,
                                edited_at: r.edited_at,
                                reactions: reactions.get(&r.id).cloned().unwrap_or_default(),
                                attachments: attachments.get(&r.id).cloned().unwrap_or_default(),
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                ChannelMessage {
                    id: row.id,
                    channel_id: row.channel_id,
                    sender_id: row.sender_id,
                    content: row.content,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    edited_at: row.edited_at,
                    deleted_at: row.deleted_at,
                    thread: ThreadInfo {
                        reply_count: td.map_or(0, |td| td.reply_count),
                        latest_reply_at: td.and_then(|td| td.latest_reply_at),
                        preview: preview_replies,
                    },
                    reactions: reactions.get(&row.id).cloned().unwrap_or_default(),
                    attachments: attachments.get(&row.id).cloned().unwrap_or_default(),
                }
            })
            .collect();

        Ok(messages)
    }
}

/// Build a centered window of messages around an anchor.
///
/// - `before`: older messages in DESC order (closest to anchor first).
/// - `anchor`: the anchor message itself.
/// - `after`: newer messages in ASC order (closest to anchor first).
/// - `limit`: total number of messages to return (including the anchor).
///
/// Returns messages in DESC order (newest first).
fn center_window(
    before: Vec<TopLevelMessageRow>,
    anchor: TopLevelMessageRow,
    after: Vec<TopLevelMessageRow>,
    limit: usize,
) -> Vec<TopLevelMessageRow> {
    if limit == 0 {
        return vec![];
    }
    if limit == 1 {
        return vec![anchor];
    }

    let slots = limit - 1; // slots available for before + after
    let half = slots / 2;

    let (before_take, after_take) = if before.len() < half {
        // Near the oldest edge: take all before, fill remainder from after.
        let bt = before.len();
        let at = (slots - bt).min(after.len());
        (bt, at)
    } else if after.len() < slots - half {
        // Near the newest edge: take all after, fill remainder from before.
        let at = after.len();
        let bt = (slots - at).min(before.len());
        (bt, at)
    } else {
        // Balanced: even split.
        (half, (slots - half).min(after.len()))
    };

    // Build result in DESC order: after (reversed) + anchor + before.
    let mut result = Vec::with_capacity(before_take + 1 + after_take);
    for row in after[..after_take].iter().rev() {
        result.push(row.clone());
    }
    result.push(anchor);
    result.extend_from_slice(&before[..before_take]);

    result
}

impl<R> ChannelMessagesService for ChannelMessagesServiceImpl<R>
where
    R: ChannelMessagesRepo,
    anyhow::Error: From<R::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_channel_messages(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        limit: u16,
    ) -> Result<ChannelMessagesPage, ChannelMessagesErr> {
        let limit = limit.clamp(1, 100);

        let rows = self
            .repo
            .get_top_level_messages(channel_id, &query, limit)
            .await
            .map_err(anyhow::Error::from)?;

        let messages = self.hydrate_messages(rows).await?;

        let page = messages
            .into_iter()
            .paginate_on(limit.into(), CreatedAt)
            .filter_on(())
            .into_page();

        Ok(page)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_attachments(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        limit: u16,
    ) -> Result<ChannelAttachmentsPage, ChannelMessagesErr> {
        let limit = limit.clamp(1, 100);

        let attachments = self
            .repo
            .get_channel_attachments(channel_id, &query, limit)
            .await
            .map_err(anyhow::Error::from)?;

        let page = attachments
            .into_iter()
            .paginate_on(limit.into(), CreatedAt)
            .filter_on(())
            .into_page();

        Ok(page)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_participants(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, ChannelMessagesErr> {
        let participants = self
            .repo
            .get_channel_participants(channel_id)
            .await
            .map_err(anyhow::Error::from)?;

        Ok(participants)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_messages_around(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        limit: u16,
    ) -> Result<ChannelMessagesPage, ChannelMessagesErr> {
        let limit = limit.clamp(1, 100);

        let anchor = self
            .repo
            .resolve_top_level_parent(channel_id, message_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(ChannelMessagesErr::MessageNotFound(message_id))?;

        let (before, after) = self
            .repo
            .get_top_level_messages_around(channel_id, anchor.created_at, anchor.id, limit)
            .await
            .map_err(anyhow::Error::from)?;

        let rows = center_window(before, anchor, after, limit.into());
        let messages = self.hydrate_messages(rows).await?;

        let page = messages
            .into_iter()
            .paginate_on(limit.into(), CreatedAt)
            .filter_on(())
            .into_page();

        Ok(page)
    }
}
