//! Historical transcript schemas: saved calls of tools no host offers still
//! parse and render. Never merge this into executable toolsets.
//!
//! To delete a native tool whose calls appear in saved conversations, keep
//! its input and output types and register them in [`RetiredTools`] as a
//! [`PhantomTool`](ai_toolset::schema::PhantomTool) under the tool's name.
//! Its generated TypeScript and web card then keep working while no host can
//! call it.
use crate::schemas::read;
use crate::{ToolChatService, ToolEntityAccessService};
use ai_toolset::schema::{FrontendToolEntry, ToolSchemaGenerator};
use schemars::{JsonSchema, SchemaGenerator};
use serde_json::json;

#[cfg(test)]
mod test;
mod types;

/// Schema-only registrations for tools no host offers.
pub(super) struct RetiredTools;

impl ToolSchemaGenerator for RetiredTools {
    fn register_schemas(&self, generator: &mut SchemaGenerator) -> Vec<FrontendToolEntry> {
        let retired: [&dyn ToolSchemaGenerator; 2] = [
            &chat::inbound::toolset::chat_toolset::<ToolChatService, ToolEntityAccessService>(),
            &read::read_thread(),
        ];
        retired
            .into_iter()
            .flat_map(|tools| tools.register_schemas(generator))
            .collect()
    }
}

/// Adds the legacy conversation values to the entity enums and listing union
/// saved calls used.
pub(super) struct LegacyConversationSchemas;

impl ToolSchemaGenerator for LegacyConversationSchemas {
    fn register_schemas(&self, generator: &mut SchemaGenerator) -> Vec<FrontendToolEntry> {
        // Register the patched definitions directly, so they exist even when
        // no live tool uses them.
        types::register(generator);
        // Search output shapes are unchanged except that live tools filter out chats.
        // Retain the old union for saved responses, including its linked definitions.
        let search = models_search::unified::UnifiedSearchResponseItem::json_schema(generator);
        generator
            .definitions_mut()
            .insert("SessionAwareSearchResult".into(), search.into());
        let definitions = generator.definitions_mut();
        for (name, value) in [
            ("SearchEntityType", "chats"),
            ("ItemType", "ai_chat"),
            ("ProjectItemType", "chat"),
            ("RenameableEntityType", "chat"),
            ("MoveableEntityType", "chat"),
            ("TrashableEntityType", "chat"),
            ("DuplicableEntityType", "chat"),
            ("SharingEntityType", "chat"),
            ("FavoritableEntityType", "chat"),
            ("ToolEntityType", "chat"),
            ("ToolPropertyTargetEntityType", "chat"),
            ("ChannelShareEntityType", "chat"),
            ("NotificationEntityType", "chat"),
            ("ToolNotificationCategory", "chat"),
        ] {
            let schema = definitions
                .get_mut(name)
                .expect("historical tool type exists");
            if let Some(values) = schema.get_mut("enum").and_then(|v| v.as_array_mut()) {
                values.push(json!(value));
            } else {
                schema
                    .get_mut("oneOf")
                    .and_then(|v| v.as_array_mut())
                    .expect("historical entity enum")
                    .push(json!({"type":"string", "const":value}));
            }
        }
        definitions
            .get_mut("EntityItem")
            .expect("listing output")
            .get_mut("oneOf")
            .and_then(|v| v.as_array_mut())
            .expect("listing union")
            .push(json!({
                "type":"object",
                "properties": {
                    "type":{"type":"string","const":"aiChat"},
                    "id":{"type":"string","format":"uuid"},
                    "name":{"type":"string"},
                    "tags":{"type":"array","items":{"$ref":"#/$defs/AppliedTag"},"default":[]}
                },
                "required":["type","id","name"]
            }));
        Vec::new()
    }
}
