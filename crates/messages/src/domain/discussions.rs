//! A parent's live discussions as a reader of the whole entity sees them:
//! every thread with all of its replies, oldest thread first.

use std::collections::HashMap;

use entity_access::domain::models::EntityAccessReceipt;
use futures::{StreamExt, TryStreamExt, stream};
use uuid::Uuid;

use super::{
    api::MessageReader,
    models::{Message, MessageListItem, MessageThread},
    ports::{MessageError, MessageTimelineQuery},
    service::MessageView,
};

/// Discussions read per timeline page, the most the message service returns.
pub const PAGE_SIZE: u16 = 100;

/// Most discussions returned for one parent, newest kept, so a heavily
/// discussed entity cannot crowd its own content out of an agent's context.
pub const MAX_DISCUSSIONS: usize = 500;

/// Concurrent thread lookups for one read.
const LOOKUP_CONCURRENCY: usize = 8;

/// Every live discussion on the parent `access` was minted for, oldest first,
/// capped at [`MAX_DISCUSSIONS`]: [`live_roots`] followed by [`with_replies`].
pub async fn live_threads<M: MessageReader + ?Sized>(
    messages: &M,
    access: &EntityAccessReceipt<MessageView>,
) -> Result<Vec<MessageThread>, MessageError> {
    let roots = live_roots(messages, access).await?;
    with_replies(messages, access, roots).await
}

/// The live discussion roots on the parent `access` was minted for, newest
/// first, capped at [`MAX_DISCUSSIONS`]. A deleted first comment with no live
/// replies is not a live discussion.
pub async fn live_roots<M: MessageReader + ?Sized>(
    messages: &M,
    access: &EntityAccessReceipt<MessageView>,
) -> Result<Vec<MessageListItem>, MessageError> {
    let mut roots = Vec::new();
    let mut cursor = None;
    loop {
        let page = messages
            .timeline(
                access.clone(),
                MessageTimelineQuery {
                    cursor,
                    limit: Some(PAGE_SIZE),
                    ..Default::default()
                },
            )
            .await?;
        // A deleted first comment with no live replies is not returned,
        // so it must not count toward the cap.
        roots.extend(
            page.items
                .into_iter()
                .filter(|item| item.message.deleted_at.is_none() || item.thread.reply_count > 0),
        );
        if roots.len() >= MAX_DISCUSSIONS {
            tracing::warn!(count = roots.len(), "discussions truncated");
            roots.truncate(MAX_DISCUSSIONS);
            return Ok(roots);
        }
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => return Ok(roots),
        }
    }
}

/// The threads of `roots`, oldest first, each with its live replies: the
/// timeline preview when it holds them all, else the full thread. A thread
/// whose first comment was deleted is kept only while it has live replies.
pub async fn with_replies<M: MessageReader + ?Sized>(
    messages: &M,
    access: &EntityAccessReceipt<MessageView>,
    roots: Vec<MessageListItem>,
) -> Result<Vec<MessageThread>, MessageError> {
    let partial: Vec<Uuid> = roots
        .iter()
        .filter(|item| item.thread.reply_count > item.thread.preview.len() as i64)
        .map(|item| item.message.id)
        .collect();
    let mut fetched: HashMap<Uuid, Vec<Message>> = stream::iter(partial)
        .map(|root| async move {
            let thread = messages.get_thread(access.clone(), root).await?;
            Ok::<_, MessageError>((root, thread.replies))
        })
        .buffer_unordered(LOOKUP_CONCURRENCY)
        .try_collect()
        .await?;
    Ok(roots
        .into_iter()
        .rev()
        .filter_map(|item| {
            let replies: Vec<Message> = fetched
                .remove(&item.message.id)
                .unwrap_or(item.thread.preview)
                .into_iter()
                .filter(|reply| reply.deleted_at.is_none())
                .collect();
            if item.message.deleted_at.is_some() && replies.is_empty() {
                return None;
            }
            Some(MessageThread {
                state: item.state,
                root: item.message,
                replies,
            })
        })
        .collect())
}
