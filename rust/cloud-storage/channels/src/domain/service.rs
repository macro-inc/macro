use crate::domain::{
    models::{ChannelMessage, ChannelParticipant, ThreadInfo, ThreadReply},
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

        // 6. Paginate.
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
}
