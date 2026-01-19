//! System property key enum.

use models_properties::EntityType;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Macro to define system properties with all metadata in one place.
///
/// Each property is defined once with its variant name, const name, UUID suffix, and display name.
/// The macro generates:
/// - The enum variants
/// - UUID constants
/// - `uuid()` method
/// - `display_name()` method
/// - `from_uuid()` method
/// - `all()` iterator
macro_rules! define_system_properties {
    (
        $(
            $(#[$meta:meta])*
            $variant:ident, $const_name:ident, $uuid_suffix:expr, $display:literal
        );* $(;)?
    ) => {
        /// System property keys with stable UUIDs (macro-generated).
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum SystemPropertyKey {
            $(
                $(#[$meta])*
                $variant
            ),*
        }

        impl SystemPropertyKey {
            const BASE_UUID: u128 = 0x00000001_0000_0000_0000_000000000000;

            $(
                #[doc = concat!("UUID for ", stringify!($variant), " property")]
                pub const $const_name: Uuid = Uuid::from_u128(Self::BASE_UUID + $uuid_suffix);
            )*

            /// Get the UUID for this system property.
            pub const fn uuid(&self) -> Uuid {
                match self {
                    $(Self::$variant => Self::$const_name),*
                }
            }

            /// Get the display name for this system property.
            pub const fn display_name(&self) -> &'static str {
                match self {
                    $(Self::$variant => $display),*
                }
            }

            /// Try to get a SystemPropertyKey from a UUID.
            pub const fn from_uuid(uuid: Uuid) -> Option<Self> {
                $(
                    if uuid.as_u128() == Self::$const_name.as_u128() {
                        return Some(Self::$variant);
                    }
                )*
                None
            }

            /// Check if a UUID is a system property UUID.
            pub const fn is_system_uuid(uuid: Uuid) -> bool {
                Self::from_uuid(uuid).is_some()
            }

            /// Returns all system property keys.
            pub const fn all_system_property_keys() -> &'static [Uuid] {
                &[$(Self::$const_name),*]
            }
        }
    };
}

define_system_properties! {
    // Tasks
    Assignees,         ASSIGNEES_UUID,          0x01, "Assignees";
    Status,            STATUS_UUID,             0x02, "Status";
    Priority,          PRIORITY_UUID,           0x03, "Priority";
    DueDate,           DUE_DATE_UUID,           0x04, "Due Date";
    ParentTask,        PARENT_TASK_UUID,        0x05, "Parent Task";
    Subtasks,          SUBTASKS_UUID,           0x06, "Subtasks";
    DependsOn,         DEPENDS_ON_UUID,         0x07, "Depends On";
    Effort,            EFFORT_UUID,             0x08, "Effort";
    StoryPoints,       STORY_POINTS_UUID,       0x09, "Story Points";
    RelevantDocuments, RELEVANT_DOCUMENTS_UUID, 0x0a, "Relevant Documents";

    // Emails Attachments
    Source,            SOURCE_UUID,             0x0b, "Source";
    Companies,         COMPANIES_UUID,          0x0c, "Companies";
    Sender,            SENDER_UUID,             0x0d, "Sender";
    Recipients,        RECIPIENTS_UUID,         0x0e, "Recipients";
    Subject,           SUBJECT_UUID,            0x0f, "Subject";
}

impl SystemPropertyKey {
    /// Returns the property definition IDs that are required (cannot be removed) for a given entity type.
    /// These are fundamental built-in properties that define the entity's core behavior.
    ///
    /// Extensible: Add new entity types and their required properties here as needed.
    pub const fn required_property_ids_for_entity(entity_type: EntityType) -> &'static [Uuid] {
        match entity_type {
            EntityType::Task => &[
                Self::ASSIGNEES_UUID,
                Self::STATUS_UUID,
                Self::PRIORITY_UUID,
                Self::DUE_DATE_UUID,
                Self::PARENT_TASK_UUID,
                Self::SUBTASKS_UUID,
                Self::DEPENDS_ON_UUID,
                Self::EFFORT_UUID,
                Self::STORY_POINTS_UUID,
                Self::RELEVANT_DOCUMENTS_UUID,
            ],
            // Other entity types don't have required properties yet
            // Add new cases here as needed:
            // EntityType::Email => &[...],
            _ => &[],
        }
    }

    /// Check if a property definition cannot be removed from the given entity type.
    pub fn is_required_for_entity(property_definition_id: Uuid, entity_type: EntityType) -> bool {
        Self::required_property_ids_for_entity(entity_type).contains(&property_definition_id)
    }
}
