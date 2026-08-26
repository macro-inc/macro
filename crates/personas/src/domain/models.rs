//! Persona domain models.
//!
//! Users see personas as "agents"; the internal name stays persona because
//! "agent" is overloaded across the codebase (harness, session, trigger).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Persona ids are minted in the bot id space: everything downstream of a
/// persona - mentions (`bot|{id}`), `agent_session.bot_id`, trigger events -
/// speaks [`BotId`].
pub use bot_id::BotId;

/// Maximum Unicode scalar values in a persona name.
pub const MAX_PERSONA_NAME_CHARS: usize = 128;
/// Maximum Unicode scalar values in a persona handle.
pub const MAX_PERSONA_HANDLE_CHARS: usize = 64;
/// Maximum Unicode scalar values in a persona description.
pub const MAX_PERSONA_DESCRIPTION_CHARS: usize = 2000;
/// Maximum Unicode scalar values in a persona system prompt.
pub const MAX_PERSONA_SYSTEM_PROMPT_CHARS: usize = 32_768;
/// Maximum bytes in a persona avatar URL.
pub const MAX_PERSONA_AVATAR_URL_BYTES: usize = 2048;

/// A persona: a user-configured agent identity.
///
/// The configurable half of an agent. The running half is a harness; every
/// persona runs on the in-memory agent in this iteration, so the pairing is
/// implicit rather than a field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Persona {
    /// Persona id, in the bot id space.
    pub id: BotId,
    /// The user who owns and edits the persona.
    pub owner_user_id: String,
    /// Display name.
    pub name: String,
    /// Typed after `@` to mention the persona. Lower kebab-case.
    pub handle: String,
    /// Optional description shown in settings.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// Markdown instructions prepended to the persona's sessions. `None`
    /// means the persona adds nothing beyond the base agent prompt.
    pub system_prompt: Option<String>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last edit time.
    pub updated_at: DateTime<Utc>,
}

/// Request to create a persona. The caller becomes the owner.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreatePersonaRequest {
    /// Display name.
    pub name: String,
    /// Stable handle, used for `@` mentions.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// Markdown instructions prepended to every session.
    pub system_prompt: Option<String>,
}

/// Deserialize a present-but-possibly-null field as `Some(inner)`, so a
/// patch can tell "absent, leave unchanged" (`None`, via `default`) from
/// "null, clear it" (`Some(None)`). Serde alone collapses both to `None`.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

/// Request to patch a persona.
///
/// Absent fields are left unchanged. The nullable fields distinguish absent
/// from null: sending `null` clears the field.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchPersonaRequest {
    /// Display name.
    pub name: Option<String>,
    /// Stable handle.
    pub handle: Option<String>,
    /// Description. `null` clears it.
    #[serde(default, deserialize_with = "double_option")]
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub description: Option<Option<String>>,
    /// Avatar URL. `null` clears it.
    #[serde(default, deserialize_with = "double_option")]
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub avatar_url: Option<Option<String>>,
    /// System prompt. `null` clears it.
    #[serde(default, deserialize_with = "double_option")]
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub system_prompt: Option<Option<String>>,
}
