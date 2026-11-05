//! Replies to threads that live in another user's inbox and were shared with
//! the caller. Entity access stays behind a port.

use std::{future::Future, pin::Pin};

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::EmailErr;

/// Boxed so the service can inject the capability without propagating the
/// entity-access generics to every email consumer.
pub type ReplyTargetInboxFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<Uuid>, EmailErr>> + Send + 'a>>;

/// Finds the inbox holding a message the caller may reply to through a share.
pub trait SharedThreadReplyAccess: Send + Sync + 'static {
    /// The inbox of `message_id` when `actor` holds edit access to its thread,
    /// so they can answer it from an inbox of their own; `None` otherwise.
    fn reply_target_inbox<'a>(
        &'a self,
        actor: &'a MacroUserIdStr<'static>,
        message_id: Uuid,
    ) -> ReplyTargetInboxFuture<'a>;
}

/// Hosts without entity access answer only messages in the caller's inboxes.
pub struct NoSharedThreadReplies;

impl SharedThreadReplyAccess for NoSharedThreadReplies {
    fn reply_target_inbox<'a>(
        &'a self,
        _actor: &'a MacroUserIdStr<'static>,
        _message_id: Uuid,
    ) -> ReplyTargetInboxFuture<'a> {
        Box::pin(async { Ok(None) })
    }
}
