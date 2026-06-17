//! Types and errors used by the chat domain ports.

mod chat;
mod error;
mod message;
pub mod model_access;

pub use chat::{ChatResponse, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs};
pub use error::{ChatErr, Result};
pub use message::{PatchChatMessageArgs, ResolvedMessageContent, WebCitation};
pub use model_access::{CHAT_MODELS, FREE_MODEL, ModelAccess, ModelsResponse};
