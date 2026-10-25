//! Provider-neutral email API models.

mod address_book;
mod auth;
mod changes;
mod draft;
mod error;
mod mailbox;
mod mailbox_settings;
mod operation;
mod provider;
mod send;

pub use address_book::*;
pub use auth::{AccessToken, TokenError, TokenFreshness};
pub use changes::{ChangeBatch, InboxChanges, SyncCursor};
pub use draft::*;
pub use error::{EmailApiError, RateLimitOrigin, RateLimitRefusal};
pub use mailbox::{CalendarPart, MessageWithCalendarParts, ProviderSubscription, ThreadListPage};
pub use mailbox_settings::*;
pub use operation::ApiOperationKind;
pub use provider::*;
#[cfg(feature = "ports")]
pub use send::PreparedSendMessage;
#[cfg(feature = "ports")]
pub(crate) use send::validate_message_id;
pub use send::{SendRequest, SentIds};
