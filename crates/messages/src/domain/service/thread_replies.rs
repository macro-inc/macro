//! Reading a discussion's replies one window at a time.
use entity_access::domain::models::EntityAccessReceipt;
use uuid::Uuid;

use super::{MessageService, MessageView, log_read_error, parent_from_receipt};
use crate::domain::ports::{
    MessageError, MessageEventPublisher, MessageRepository, ThreadRepliesPage, ThreadRepliesQuery,
};

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// One window of a discussion's live replies: the start or the end of the
    /// thread, the replies on one side of a cursor, or the replies around one
    /// reply. Access, the thread and its root are checked as
    /// [`Self::get_thread`] checks them, and each reply reads as it does there.
    #[tracing::instrument(skip(self, access), fields(replies = tracing::field::Empty))]
    pub async fn thread_replies(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root_id: Uuid,
        query: ThreadRepliesQuery,
    ) -> Result<ThreadRepliesPage, MessageError> {
        async {
            if query.around.is_some() && query.cursor.is_some() {
                return Err(MessageError::Invalid(
                    "a window around a reply cannot have a cursor",
                ));
            }
            let parent = parent_from_receipt(&access)?;
            self.ensure_parent(&parent).await?;
            let state = self.active_thread(&parent, root_id).await?;
            let root = self.active_message(&parent, root_id, true).await?;
            let window = self.repo.thread_replies(&parent, root_id, &query).await?;
            tracing::Span::current().record("replies", window.replies.len());
            Ok(ThreadRepliesPage {
                state,
                root,
                replies: window.replies,
                older_cursor: window.older_cursor,
                newer_cursor: window.newer_cursor,
            })
        }
        .await
        .inspect_err(log_read_error)
    }
}
