//! Types and errors used by the chat domain ports.

mod chat;
mod error;
mod message;

pub use chat::{ChatResponse, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs};
pub use error::{ChatErr, Result};
pub use message::{PatchChatMessageArgs, ResolvedMessageContent, WebCitation};
