//! The legacy CRM comment API served from the shared message store.
//!
//! CRM discussions live in `comms_messages` with `crm_company` / `crm_contact`
//! parents. These routes keep their request and response shapes for clients
//! that still speak them: a thread is a discussion root, identified by the
//! root message id, and a comment is a message. Imported comments keep their
//! `crm_comment` ids, so ids a client already holds stay valid.

use entity_access::domain::models::EntityAccessReceipt;
use messages::domain::{
    api::MessageServiceApi,
    models::{Message, MessageAttribution, MessageThread, PostMessage},
    ports::{MessageError, MessagePatch, MessageTimelineQuery},
    service::{MessageView, MessageWrite},
};
use uuid::Uuid;

use crate::domain::{
    comment::{
        CrmComment, CrmCommentEntityType, CrmCommentThread, CrmThread, DeleteCrmCommentResult,
    },
    model::CrmError,
};

#[cfg(test)]
mod test;

/// Page size for reading a record's discussions; CRM records carry few.
const TIMELINE_PAGE: u16 = 100;

/// Legacy CRM comment operations over the shared message service.
pub struct CrmCommentAdapter<'a> {
    messages: &'a dyn MessageServiceApi,
}

impl<'a> CrmCommentAdapter<'a> {
    /// Serve the legacy shapes from `messages`.
    pub fn new(messages: &'a dyn MessageServiceApi) -> Self {
        Self { messages }
    }

    /// Live discussions on the record, oldest first, each with its live
    /// comments oldest first, as the legacy list returned them.
    pub async fn list(
        &self,
        access: EntityAccessReceipt<MessageView>,
        entity_type: CrmCommentEntityType,
        entity_id: Uuid,
    ) -> Result<Vec<CrmCommentThread>, CrmError> {
        let mut roots = Vec::new();
        let mut cursor = None;
        loop {
            let page = self
                .messages
                .timeline(
                    access.clone(),
                    MessageTimelineQuery {
                        cursor,
                        limit: Some(TIMELINE_PAGE),
                        ..Default::default()
                    },
                )
                .await
                .map_err(thread_error)?;
            roots.extend(page.items.into_iter().map(|item| item.message.id));
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        let mut threads = Vec::with_capacity(roots.len());
        for root in roots {
            let thread = self
                .messages
                .get_thread(access.clone(), root)
                .await
                .map_err(thread_error)?;
            if let Some(thread) = legacy_thread(thread, entity_type, entity_id) {
                threads.push(thread);
            }
        }
        threads.sort_by(|a, b| {
            (a.thread.created_at, a.thread.thread_id)
                .cmp(&(b.thread.created_at, b.thread.thread_id))
        });
        Ok(threads)
    }

    /// Whether `id` is a live discussion root on the record.
    pub async fn is_root(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<bool, CrmError> {
        match self.messages.get_thread(access, id).await {
            Ok(thread) => Ok(thread.state.deleted_at.is_none()),
            Err(MessageError::NotFound) => Ok(false),
            Err(error) => Err(thread_error(error)),
        }
    }

    /// Post a new discussion, or a reply when `root` names one, and return the
    /// whole thread afterwards.
    pub async fn create(
        &self,
        write: EntityAccessReceipt<MessageWrite>,
        view: EntityAccessReceipt<MessageView>,
        entity_type: CrmCommentEntityType,
        entity_id: Uuid,
        root: Option<Uuid>,
        text: &str,
    ) -> Result<CrmCommentThread, CrmError> {
        let message = self
            .messages
            .post(
                write,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::default(),
                    notification_policy: Default::default(),
                    content: text.to_owned(),
                    thread_id: root,
                    anchor: None,
                    mentions: vec![],
                    attachments: vec![],
                    nonce: None,
                },
            )
            .await
            .map_err(thread_error)?;
        let thread = self
            .messages
            .get_thread(view, message.root_id())
            .await
            .map_err(thread_error)?;
        legacy_thread(thread, entity_type, entity_id).ok_or(CrmError::ThreadNotFound)
    }

    /// Replace a comment's text; only its author may.
    pub async fn edit(
        &self,
        write: EntityAccessReceipt<MessageWrite>,
        comment_id: Uuid,
        text: &str,
    ) -> Result<CrmComment, CrmError> {
        let message = self
            .messages
            .patch(
                write,
                comment_id,
                MessagePatch {
                    content: Some(text.to_owned()),
                    ..Default::default()
                },
            )
            .await
            .map_err(comment_error)?;
        Ok(legacy_comment(message))
    }

    /// Delete a comment. Deleting a discussion's first comment deletes the
    /// discussion, which the result reports as `threadDeleted`.
    pub async fn delete(
        &self,
        write: EntityAccessReceipt<MessageWrite>,
        comment_id: Uuid,
    ) -> Result<DeleteCrmCommentResult, CrmError> {
        let message = self
            .messages
            .delete(write, comment_id, None)
            .await
            .map_err(comment_error)?;
        Ok(DeleteCrmCommentResult {
            comment_id: message.id,
            thread_id: message.root_id(),
            thread_deleted: message.thread_id.is_none(),
        })
    }
}

fn legacy_thread(
    thread: MessageThread,
    entity_type: CrmCommentEntityType,
    entity_id: Uuid,
) -> Option<CrmCommentThread> {
    if thread.state.deleted_at.is_some() {
        return None;
    }
    let comments: Vec<CrmComment> = std::iter::once(thread.root)
        .chain(thread.replies)
        .filter(|message| message.deleted_at.is_none())
        .map(legacy_comment)
        .collect();
    if comments.is_empty() {
        return None;
    }
    let state = thread.state;
    Some(CrmCommentThread {
        thread: CrmThread {
            thread_id: state.root_id,
            entity_type,
            entity_id,
            owner: state.user_id,
            resolved: state.resolved,
            metadata: None,
            created_at: state.created_at,
            updated_at: state.updated_at,
            deleted_at: state.deleted_at,
        },
        comments,
    })
}

fn legacy_comment(message: Message) -> CrmComment {
    CrmComment {
        comment_id: message.id,
        thread_id: message.root_id(),
        order: None,
        owner: String::from(message.sender_id.clone()),
        sender: None,
        text: message.content,
        metadata: None,
        created_at: message.created_at,
        updated_at: message.updated_at,
        deleted_at: message.deleted_at,
    }
}

fn thread_error(error: MessageError) -> CrmError {
    match error {
        MessageError::NotFound => CrmError::ThreadNotFound,
        other => common_error(other),
    }
}

fn comment_error(error: MessageError) -> CrmError {
    match error {
        MessageError::NotFound => CrmError::CommentNotFound,
        MessageError::Forbidden => CrmError::CommentNotOwned,
        other => common_error(other),
    }
}

fn common_error(error: MessageError) -> CrmError {
    match error {
        MessageError::Invalid(reason) => CrmError::InvalidRequest(reason.to_owned()),
        other => CrmError::StorageLayerError(anyhow::anyhow!(other.to_string())),
    }
}
