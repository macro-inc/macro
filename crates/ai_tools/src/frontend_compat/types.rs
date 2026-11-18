//! The definitions [`LegacyConversationSchemas`](super::LegacyConversationSchemas)
//! patches. They are registered here rather than only through the tools that
//! take them, so deleting such a tool cannot drop a definition codegen needs.
//! Deleting one of these types breaks this module's build: move the type here
//! first.

use crate::search::search_service::types::SearchEntityType;
use channels::domain::models::ChannelShareEntityType;
use favorites::inbound::toolset::FavoritableEntityType;
use models_properties::service::tag_sets::AppliedTag;
use notification::inbound::ai_tool::{NotificationEntityType, ToolNotificationCategory};
use projects::inbound::toolset::{
    DuplicableEntityType, MoveableEntityType, ProjectItemType, RenameableEntityType,
    SharingEntityType, TrashableEntityType,
};
use properties::inbound::toolset::{ToolEntityType, ToolPropertyTargetEntityType};
use schemars::SchemaGenerator;
use soup::inbound::toolset::{EntityItem, ItemType};

/// Adds every patched definition to `generator`'s `$defs`.
pub(super) fn register(generator: &mut SchemaGenerator) {
    generator.subschema_for::<SearchEntityType>();
    generator.subschema_for::<ItemType>();
    generator.subschema_for::<ProjectItemType>();
    generator.subschema_for::<RenameableEntityType>();
    generator.subschema_for::<MoveableEntityType>();
    generator.subschema_for::<TrashableEntityType>();
    generator.subschema_for::<DuplicableEntityType>();
    generator.subschema_for::<SharingEntityType>();
    generator.subschema_for::<FavoritableEntityType>();
    generator.subschema_for::<ToolEntityType>();
    generator.subschema_for::<ToolPropertyTargetEntityType>();
    generator.subschema_for::<ChannelShareEntityType>();
    generator.subschema_for::<NotificationEntityType>();
    generator.subschema_for::<ToolNotificationCategory>();
    generator.subschema_for::<EntityItem>();
    generator.subschema_for::<AppliedTag>();
}
