//! Web API methods, grouped by area, as methods on [`crate::SlackClient`].

mod auth;
mod boot;
mod chat;
mod conversations;
mod files;
mod users;

pub use auth::{AuthTest, validate_session};
pub use boot::{BootChannel, ChannelCounts, ClientCounts, ThreadCounts, UserBoot};
pub use chat::{DeletedMessage, PostMessage, PostedMessage, UpdateMessage, UpdatedMessage};
pub use conversations::{
    ConversationType, ConversationView, ConversationsPage, HistoryPage, HistoryRequest,
    MembersPage, RepliesRequest, UsersConversationsRequest,
};
pub use files::{FileUpload, UploadedFile};
pub use users::CustomEmoji;
