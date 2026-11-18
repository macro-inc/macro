//! Historical transcript schemas. Never merge this into executable toolsets.
use ai_toolset::schema::{FrontendToolEntry, ToolSchemaGenerator};
use schemars::{JsonSchema, SchemaGenerator};
use serde_json::json;

pub(super) struct LegacyConversationSchemas;

impl ToolSchemaGenerator for LegacyConversationSchemas {
    fn register_schemas(&self, generator: &mut SchemaGenerator) -> Vec<FrontendToolEntry> {
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

/// The code tools' frontend schemas. Chat runs the user-scoped `ExecuteCode`,
/// whose arguments and receipt differ from an agent session's under the same
/// tool name, so the frontend's `ExecuteCode` tool types are new unions of the
/// two. The shared `ExecuteCode` and `ExecutionReceipt` definitions keep the
/// session shapes, so nothing else that references them is widened.
pub(super) struct CodeModeSchemas;

impl ToolSchemaGenerator for CodeModeSchemas {
    fn register_schemas(&self, generator: &mut SchemaGenerator) -> Vec<FrontendToolEntry> {
        let mut entries = agent_code_mode::inbound::toolset::toolset().register_schemas(generator);
        let user_input: serde_json::Value = generator
            .subschema_for::<agent_code_mode::inbound::toolset::UserExecuteCode>()
            .into();
        let user_output: serde_json::Value = generator
            .subschema_for::<agent_code_mode::domain::UserExecutionReceipt>()
            .into();
        let entry = entries
            .iter_mut()
            .find(|entry| entry.name == "ExecuteCode")
            .expect("the session code tools include ExecuteCode");
        let definitions = generator.definitions_mut();
        for (side, name, user) in [
            (&mut entry.input, "ExecuteCodeCall", user_input),
            (&mut entry.output, "ExecuteCodeReceipt", user_output),
        ] {
            let session = json!({ "$ref": format!("#/$defs/{side}") });
            definitions.insert(name.into(), json!({ "anyOf": [session, user] }));
            *side = name.into();
        }
        entries
    }
}
