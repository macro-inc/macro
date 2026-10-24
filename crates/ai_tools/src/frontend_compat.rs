//! Historical transcript schemas. Never merge this into executable toolsets.
use ai_toolset::schema::{FrontendToolEntry, ToolSchemaGenerator};
use schemars::{JsonSchema, SchemaGenerator};
use serde_json::json;

use crate::show::{Show, ShowResponse};

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
        // `Show` was called `DisplayResults`; saved chats name it so.
        generator.subschema_for::<Show>();
        generator.subschema_for::<ShowResponse>();
        vec![FrontendToolEntry {
            name: "DisplayResults".to_owned(),
            input: Show::schema_name().into_owned(),
            output: ShowResponse::schema_name().into_owned(),
        }]
    }
}
