use crate::domain::{
    models::{ChannelMessage, ThreadInfo, ThreadReply},
    ports::{ChannelMessagesErr, ChannelMessagesPage, ChannelMessagesRepo, ChannelMessagesService},
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

        // 1. Fetch top-level messages with thread stats.
        let rows = self
            .repo
            .get_top_level_messages(channel_id, &query, limit)
            .await
            .map_err(anyhow::Error::from)?;

        let parent_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();

        // 2 + 3. Fetch thread previews, reactions, and attachments in parallel.
        let (thread_previews, reactions, attachments) = {
            let previews_fut = self
                .repo
                .get_thread_previews(&parent_ids, THREAD_PREVIEW_COUNT);

            // Collect ALL message ids (top-level + preview replies) for reactions/attachments
            // We need previews first to know reply ids, so fetch previews first,
            // then reactions+attachments in parallel.
            let previews = previews_fut.await.map_err(anyhow::Error::from)?;

            let mut all_ids: Vec<Uuid> = parent_ids.clone();
            for replies in previews.values() {
                for reply in replies {
                    all_ids.push(reply.id);
                }
            }

            let (reactions, attachments) = tokio::join!(
                self.repo.get_reactions_batch(&all_ids),
                self.repo.get_attachments_batch(&all_ids),
            );

            (
                previews,
                reactions.map_err(anyhow::Error::from)?,
                attachments.map_err(anyhow::Error::from)?,
            )
        };

        // 4. Assemble ChannelMessages.
        let messages: Vec<ChannelMessage> = rows
            .into_iter()
            .map(|row| {
                let preview_replies = thread_previews
                    .get(&row.id)
                    .map(|replies| {
                        replies
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
                        reply_count: row.thread_reply_count,
                        latest_reply_at: row.latest_reply_at,
                        preview: preview_replies,
                    },
                    reactions: reactions.get(&row.id).cloned().unwrap_or_default(),
                    attachments: attachments.get(&row.id).cloned().unwrap_or_default(),
                }
            })
            .collect();

        // 5. Paginate.
        let page = messages
            .into_iter()
            .paginate_on(limit.into(), CreatedAt)
            .filter_on(())
            .into_page();

        Ok(page)
    }
}
