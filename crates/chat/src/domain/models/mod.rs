//! Types and errors used by the chat domain ports.

mod chat;
mod error;
mod message;
pub mod model_access;

#[cfg(test)]
pub use chat::CreateChatArgs;
pub use chat::{ChatResponse, CopyChatArgs, GetChatResponse, PatchChatArgs, PatchChatRepoArgs};
pub use error::{ChatErr, Result};
pub use message::WebCitation;
pub use model_access::{CHAT_MODELS, FREE_MODEL, FreeTierModel, PAID_DEFAULT_MODEL};
