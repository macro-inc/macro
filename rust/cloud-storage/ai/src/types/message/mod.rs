mod chat_message;
mod message_builder;
mod system_prompt;

pub use chat_message::*;
pub use message_builder::*;
pub use system_prompt::*;

use serde::{Deserialize, Serialize};
use strum::{AsRefStr, Display, EnumString};
use utoipa::ToSchema;

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Display,
    Copy,
    Clone,
    EnumString,
    PartialEq,
    ToSchema,
    AsRefStr,
    Eq,
)]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    System,
}
