//! Synced-mail reads, including the public and internal routes' distinct policies.

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_email::service::{
    message::{
        MessageSenderInfo, MessageSendersRequest, MessageSendersResponse, ParsedMessage,
        ThreadHistoryInfo, ThreadHistoryRequest, ThreadHistoryResponse,
    },
    thread::GetThreadOwnerResponse,
};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[cfg(test)]
mod test;

const DEFAULT_MESSAGE_LIMIT: i64 = 5;
const MESSAGE_MAX: i64 = 100;

/// Raw pagination inputs; public and internal reads intentionally interpret bounds differently.
pub struct ThreadMessagesRequest {
    /// Thread whose stored messages are requested.
    pub thread_id: Uuid,
    /// Number of messages to skip, before access filtering.
    pub offset: Option<i64>,
    /// Maximum number of messages, before access filtering.
    pub limit: Option<i64>,
}

/// Stored facts used by the synced-mail read use cases.
pub trait MessageReadRepository: Send + Sync + 'static {
    /// Original persistence failure, retained for the caller's existing error rendering.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Read one parsed message, without loading its body.
    fn message(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ParsedMessage>, Self::Err>> + Send;
    /// Read parsed messages and bodies, in the database's result order.
    fn messages(
        &self,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ParsedMessage>, Self::Err>> + Send;
    /// Read a stored thread page, newest first and with null dates last.
    fn thread_messages(
        &self,
        id: Uuid,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<ParsedMessage>, Self::Err>> + Send;
    /// Return the caller's own and delegated inbox identifiers.
    fn readable_inbox_ids(
        &self,
        caller: &str,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
    /// Return the newest owned inbox from the existing single-link lookup.
    fn newest_owned_inbox(
        &self,
        caller: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
    /// Read sender facts scoped to the supplied inboxes.
    fn senders(
        &self,
        inboxes: &[Uuid],
        ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, MessageSenderInfo>, Self::Err>> + Send;
    /// Read history facts scoped to the supplied inboxes.
    fn histories(
        &self,
        inboxes: &[Uuid],
        ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, ThreadHistoryInfo>, Self::Err>> + Send;
    /// Read the stored owner string, including invalid legacy values.
    fn thread_owner(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// A public message lookup or its caller-scoped access check failed.
#[derive(Debug, thiserror::Error)]
pub enum MessageReadError<E> {
    /// No requested message exists.
    #[error("Message not found")]
    NotFound,
    /// No returned message belongs to an accessible inbox.
    #[error("Unauthorized")]
    Unauthorized,
    /// The parsed-message lookup failed.
    #[error("message lookup failed: {0}")]
    Messages(#[source] E),
    /// The own/delegated inbox lookup failed.
    #[error("inbox lookup failed: {0}")]
    Inboxes(#[source] E),
}

/// A public thread read failed before or after loading its page.
#[derive(Debug, thiserror::Error)]
pub enum ThreadReadError<E> {
    /// Invalid bounds, checked before any database reads.
    #[error("Validation error: {0}")]
    Validation(PaginationError),
    /// The own/delegated inbox lookup failed.
    #[error("inbox lookup failed: {0}")]
    Inboxes(#[source] E),
    /// The parsed-message page lookup failed.
    #[error("message lookup failed: {0}")]
    Messages(#[source] E),
    /// The page contains no accessible messages, including an empty page.
    #[error("Unauthorized")]
    Unauthorized,
}

/// An internal message read failed or found no requested messages.
#[derive(Debug, thiserror::Error)]
pub enum InternalMessageReadError<E> {
    /// No requested message exists (an empty batch still succeeds).
    #[error("message not found")]
    NotFound,
    /// The parsed-message lookup failed.
    #[error("message lookup failed: {0}")]
    Query(#[source] E),
}

/// A summary read could not resolve or query the newest owned inbox.
#[derive(Debug, thiserror::Error)]
pub enum SummaryReadError<E> {
    /// The requested user has no owned inbox.
    #[error("Link not found for user {0}")]
    LinkNotFound(String),
    /// An inbox or summary query failed.
    #[error("Database query failed: {0}")]
    Query(#[source] E),
}

/// A thread's stored owner could not be returned as a valid user identifier.
#[derive(Debug, thiserror::Error)]
pub enum ThreadOwnerError<E> {
    /// No thread exists with the requested identifier.
    #[error("thread not found")]
    NotFound,
    /// The stored owner is not a valid Macro user identifier.
    #[error("invalid macro user id")]
    InvalidOwner,
    /// The owner query failed.
    #[error("unable to get owner for thread: {0}")]
    Query(#[source] E),
}

/// Owns access, absence, partial-result, pagination, and summary-inbox policy.
pub struct MessageReadService<R> {
    /// Fetches stored facts without making route policy decisions.
    pub repository: R,
}

impl<R: MessageReadRepository> MessageReadService<R> {
    /// Read a message from any of the caller's own or delegated inboxes.
    pub async fn message(
        &self,
        caller: &str,
        id: Uuid,
    ) -> Result<ParsedMessage, MessageReadError<R::Err>> {
        let message = self
            .repository
            .message(id)
            .await
            .map_err(MessageReadError::Messages)?
            .ok_or(MessageReadError::NotFound)?;
        let inboxes = self
            .repository
            .readable_inbox_ids(caller)
            .await
            .map_err(MessageReadError::Inboxes)?;
        if inboxes.contains(&message.link_id) {
            Ok(message)
        } else {
            Err(MessageReadError::Unauthorized)
        }
    }

    /// Read the accessible subset, retaining database order and legacy duplicate warnings.
    pub async fn messages(
        &self,
        caller: &str,
        ids: &[Uuid],
    ) -> Result<Vec<ParsedMessage>, MessageReadError<R::Err>> {
        let messages = self
            .repository
            .messages(ids)
            .await
            .map_err(MessageReadError::Messages)?;
        if messages.is_empty() {
            tracing::trace!("no messages found");
            return Err(MessageReadError::NotFound);
        }
        let inboxes: HashSet<_> = self
            .repository
            .readable_inbox_ids(caller)
            .await
            .map_err(MessageReadError::Inboxes)?
            .into_iter()
            .collect();
        let accessible_messages: Vec<_> = messages
            .into_iter()
            .filter(|msg| inboxes.contains(&msg.link_id))
            .collect();
        if accessible_messages.is_empty() {
            return Err(MessageReadError::Unauthorized);
        }
        if accessible_messages.len() != ids.len() {
            let missing_ids: Vec<Uuid> = ids
                .iter()
                .filter(|id| !accessible_messages.iter().any(|m| m.db_id == **id))
                .cloned()
                .collect();
            tracing::warn!(missing_ids = ?missing_ids, "some ids not found in database or not authorized for access");
        }
        Ok(accessible_messages)
    }

    /// Reject invalid public bounds, then filter the stored page by accessible inboxes.
    pub async fn thread_messages(
        &self,
        caller: &str,
        request: ThreadMessagesRequest,
    ) -> Result<Vec<ParsedMessage>, ThreadReadError<R::Err>> {
        let (offset, limit) = public_page(&request).map_err(ThreadReadError::Validation)?;
        let inboxes: HashSet<_> = self
            .repository
            .readable_inbox_ids(caller)
            .await
            .map_err(ThreadReadError::Inboxes)?
            .into_iter()
            .collect();
        let messages = self
            .repository
            .thread_messages(request.thread_id, offset, limit)
            .await
            .map_err(ThreadReadError::Messages)?;
        let accessible_messages: Vec<_> = messages
            .into_iter()
            .filter(|msg| inboxes.contains(&msg.link_id))
            .collect();
        if accessible_messages.is_empty() {
            return Err(ThreadReadError::Unauthorized);
        }
        Ok(accessible_messages)
    }

    /// Read one message without an acting-user inbox restriction.
    pub async fn internal_message(
        &self,
        id: Uuid,
    ) -> Result<ParsedMessage, InternalMessageReadError<R::Err>> {
        self.repository
            .message(id)
            .await
            .map_err(InternalMessageReadError::Query)?
            .ok_or(InternalMessageReadError::NotFound)
    }

    /// Read an unrestricted batch; an empty request succeeds, but no matches otherwise fail.
    pub async fn internal_messages(
        &self,
        ids: &[Uuid],
    ) -> Result<Vec<ParsedMessage>, InternalMessageReadError<R::Err>> {
        let messages = self
            .repository
            .messages(ids)
            .await
            .map_err(InternalMessageReadError::Query)?;
        if messages.len() == ids.len() {
            return Ok(messages);
        }
        if !messages.is_empty() {
            let missing_ids: Vec<Uuid> = ids
                .iter()
                .filter(|id| !messages.iter().any(|m| m.db_id == **id))
                .cloned()
                .collect();
            tracing::warn!(missing_ids = ?missing_ids, "some ids not found in database");
            Ok(messages)
        } else {
            tracing::warn!("no messages found in database");
            Err(InternalMessageReadError::NotFound)
        }
    }

    /// Read an unrestricted page, falling back independently for each invalid bound.
    pub async fn internal_thread_messages(
        &self,
        request: ThreadMessagesRequest,
    ) -> Result<Vec<ParsedMessage>, R::Err> {
        let offset = request.offset.filter(|&offset| offset >= 0).unwrap_or(0);
        let limit = request
            .limit
            .filter(|&limit| 0 < limit && limit <= MESSAGE_MAX)
            .unwrap_or(DEFAULT_MESSAGE_LIMIT);
        self.repository
            .thread_messages(request.thread_id, offset, limit)
            .await
    }

    /// Read sender summaries from only the requested user's newest owned inbox.
    pub async fn senders(
        &self,
        request: MessageSendersRequest,
    ) -> Result<MessageSendersResponse, SummaryReadError<R::Err>> {
        let inbox = self
            .repository
            .newest_owned_inbox(&request.user_id)
            .await
            .map_err(SummaryReadError::Query)?
            .ok_or(SummaryReadError::LinkNotFound(request.user_id))?;
        let sender_map = self
            .repository
            .senders(&[inbox], &request.message_ids)
            .await
            .map_err(SummaryReadError::Query)?;
        Ok(MessageSendersResponse { sender_map })
    }

    /// Read history summaries from only the requested user's newest owned inbox.
    pub async fn histories(
        &self,
        request: ThreadHistoryRequest,
    ) -> Result<ThreadHistoryResponse, SummaryReadError<R::Err>> {
        let inbox = self
            .repository
            .newest_owned_inbox(&request.user_id)
            .await
            .map_err(SummaryReadError::Query)?
            .ok_or(SummaryReadError::LinkNotFound(request.user_id))?;
        let history_map = self
            .repository
            .histories(&[inbox], &request.thread_ids)
            .await
            .map_err(SummaryReadError::Query)?;
        Ok(ThreadHistoryResponse { history_map })
    }

    /// Validate the stored thread owner before returning its existing response shape.
    pub async fn thread_owner(
        &self,
        id: Uuid,
    ) -> Result<GetThreadOwnerResponse, ThreadOwnerError<R::Err>> {
        let owner = self
            .repository
            .thread_owner(id)
            .await
            .map_err(ThreadOwnerError::Query)?
            .ok_or(ThreadOwnerError::NotFound)?;
        let user_id = MacroUserIdStr::parse_from_str(&owner)
            .map_err(|_| ThreadOwnerError::InvalidOwner)?
            .into_owned();
        Ok(GetThreadOwnerResponse { user_id })
    }
}

/// Why public thread pagination was rejected before reading any stored facts.
#[derive(Debug, thiserror::Error)]
pub enum PaginationError {
    /// Offsets cannot precede the beginning of the thread.
    #[error("offset must be non-negative")]
    NegativeOffset,
    /// A public page must contain at least one possible row.
    #[error("limit must be positive")]
    NonPositiveLimit,
    /// A requested page exceeds the existing maximum.
    #[error("limit must not exceed {0}")]
    ExcessiveLimit(i64),
}

fn public_page(request: &ThreadMessagesRequest) -> Result<(i64, i64), PaginationError> {
    if request.offset.is_some_and(|offset| offset < 0) {
        return Err(PaginationError::NegativeOffset);
    }
    if let Some(limit) = request.limit {
        if limit <= 0 {
            return Err(PaginationError::NonPositiveLimit);
        }
        if limit > MESSAGE_MAX {
            return Err(PaginationError::ExcessiveLimit(MESSAGE_MAX));
        }
    }
    Ok((
        request.offset.unwrap_or(0),
        request.limit.unwrap_or(DEFAULT_MESSAGE_LIMIT),
    ))
}
