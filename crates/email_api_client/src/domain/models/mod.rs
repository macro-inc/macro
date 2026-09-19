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
pub use send::{SendRequest, SentIds};
