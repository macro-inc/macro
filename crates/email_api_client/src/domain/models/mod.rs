//! Provider-neutral email API models.

mod auth;
mod changes;
mod error;
mod mailbox;
mod operation;
mod send;

pub use auth::{AccessToken, TokenError, TokenFreshness};
pub use changes::{ChangeBatch, InboxChanges, SyncCursor};
pub use error::{EmailApiError, RateLimitOrigin, RateLimitRefusal};
pub use mailbox::{CalendarPart, MessageWithCalendarParts, ProviderSubscription, ThreadListPage};
pub use operation::ApiOperationKind;
#[cfg(feature = "ports")]
pub use send::PreparedSendMessage;
#[cfg(feature = "ports")]
pub(crate) use send::validate_message_id;
pub use send::{SendRequest, SentIds};
