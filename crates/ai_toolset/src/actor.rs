//! Explicit account selection at session tool boundaries.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

#[cfg(test)]
mod test;

/// The reserved model-facing argument consumed before underlying tool dispatch.
pub const ACTING_AS: &str = "acting_as";

/// Which authenticated participant's access a tool call requests.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Deserialize,
    Serialize,
    utoipa::ToSchema,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ToolActor {
    /// The verified human behind the current turn.
    Requester,
    /// The session owner, subject to approval when another person prompted it.
    Owner,
}

/// An invalid or unavailable actor selection. No alternate account is substituted.
#[derive(Debug, thiserror::Error)]
pub enum ActorError {
    /// Tools must explicitly choose one of the advertised actors.
    #[error("Choose acting_as: requester or owner. This tool did not run.")]
    MissingSelection,
    /// A system turn or unrepresented bot has no requester account.
    #[error(
        "This turn has no authenticated requester. Choose owner to request their approval; this tool did not run."
    )]
    NoRequester,
    /// Session tools require an active authenticated invocation.
    #[error("There is no active turn authorizing this tool; nothing was done.")]
    NoActiveTurn,
}

impl ToolActor {
    /// Remove the required routing field, leaving the underlying tool's arguments.
    pub fn take(arguments: &Value) -> Result<(Self, Value), ActorError> {
        let mut arguments = arguments
            .as_object()
            .cloned()
            .ok_or(ActorError::MissingSelection)?;
        let actor = arguments
            .remove(ACTING_AS)
            .ok_or(ActorError::MissingSelection)?;
        let actor = serde_json::from_value(actor).map_err(|_| ActorError::MissingSelection)?;
        Ok((actor, Value::Object(arguments)))
    }

    /// Resolve a choice using trusted session and turn identities only.
    pub fn resolve<'a>(
        self,
        owner: &'a MacroUserIdStr<'static>,
        requester: Option<&'a MacroUserIdStr<'static>>,
    ) -> Result<&'a MacroUserIdStr<'static>, ActorError> {
        match self {
            Self::Requester => requester.ok_or(ActorError::NoRequester),
            Self::Owner => Ok(owner),
        }
    }
}

/// Add a compact required routing parameter without changing tool input types.
/// This runs on session-facing schemas only, never public API wire types.
pub fn add_actor_schema(schema: &mut Map<String, Value>) {
    let properties = schema.entry("properties").or_insert_with(|| json!({}));
    if let Some(properties) = properties.as_object_mut() {
        properties.insert(
            ACTING_AS.into(),
            json!({
                "type": "string", "enum": ["requester", "owner"],
                "description": "Whose access to use. Prefer requester."
            }),
        );
    }
    let required = schema.entry("required").or_insert_with(|| json!([]));
    if let Some(required) = required.as_array_mut()
        && !required.iter().any(|field| field == ACTING_AS)
    {
        required.push(json!(ACTING_AS));
    }
}
