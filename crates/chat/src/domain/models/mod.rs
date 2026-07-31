//! Types and errors used by the chat domain ports.

mod chat;
mod error;
mod message;
pub mod model_access;
mod stream;

pub use chat::{
    ChatAgentKind, ChatResponse, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs,
};
pub use error::{ChatErr, Result};
pub use message::{PatchChatMessageArgs, ResolvedMessageContent, WebCitation};
pub use model_access::{CHAT_MODELS, FREE_MODEL, PAID_DEFAULT_MODEL};
pub use stream::{ChatStream, StreamError};
