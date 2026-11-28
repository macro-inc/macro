//! Explicit account selection at session tool boundaries.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

#[cfg(test)]
mod test;

/// The reserved model-facing argument consumed before underlying tool dispatch.
pub const ACTING_AS: &str = "acting_as";

/// The `acting_as` property schema, the same on every tool that takes it.
fn actor_property() -> Map<String, Value> {
    let mut property = Map::new();
    property.insert("type".into(), json!("string"));
    property.insert("enum".into(), json!(["requester", "owner"]));
    property.insert(
        "description".into(),
        json!("Whose access to use: the role \"requester\" or \"owner\", never a person's id. Prefer requester."),
    );
    property
}

/// Which authenticated participant's access a tool call requests.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolActor {
    /// The verified human behind the current turn.
    Requester,
    /// The session owner, subject to approval when another person prompted it.
    Owner,
}

/// What a refused `acting_as` is told it should be. It is in serde's own
/// shape (no quotes) so the refusal keeps it when the call's content is
/// withheld.
const EXPECTED_ACTOR: &str = "requester or owner (a role, never a person id)";

/// Reads only the two role strings. Every other value, of any type, is refused
/// without repeating it: it is often a person's id, or a number such as a phone.
impl<'de> Deserialize<'de> for ToolActor {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Role;
        impl Role {
            fn refuse<E: serde::de::Error>(self) -> Result<ToolActor, E> {
                Err(E::invalid_value(
                    serde::de::Unexpected::Other("a value that is not a role"),
                    &self,
                ))
            }
        }
        impl<'de> serde::de::Visitor<'de> for Role {
            type Value = ToolActor;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str(EXPECTED_ACTOR)
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<ToolActor, E> {
                match value {
                    "requester" => Ok(ToolActor::Requester),
                    "owner" => Ok(ToolActor::Owner),
                    _ => self.refuse(),
                }
            }

            fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<ToolActor, E> {
                self.refuse()
            }

            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<ToolActor, E> {
                self.refuse()
            }

            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<ToolActor, E> {
                self.refuse()
            }

            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<ToolActor, E> {
                self.refuse()
            }

            fn visit_unit<E: serde::de::Error>(self) -> Result<ToolActor, E> {
                self.refuse()
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, _: A) -> Result<ToolActor, A::Error> {
                self.refuse()
            }

            fn visit_map<A: serde::de::MapAccess<'de>>(self, _: A) -> Result<ToolActor, A::Error> {
                self.refuse()
            }
        }
        deserializer.deserialize_any(Role)
    }
}

/// The same plain string enum that [`add_actor_schema`] gives native tools,
/// inlined. Derived, each variant would be a `const` subschema carrying its
/// doc comment ("The session owner, ..."), which Gemini answered with the
/// session's `owner_id` from the prompt.
impl schemars::JsonSchema for ToolActor {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> std::borrow::Cow<'static, str> {
        "ToolActor".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        actor_property().into()
    }
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
        properties.insert(ACTING_AS.into(), Value::Object(actor_property()));
    }
    let required = schema.entry("required").or_insert_with(|| json!([]));
    if let Some(required) = required.as_array_mut()
        && !required.iter().any(|field| field == ACTING_AS)
    {
        required.push(json!(ACTING_AS));
    }
}
