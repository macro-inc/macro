use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_properties::{EntityReference, EntityType as PropertiesEntityType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::call_record::SoupCallRecord;
use crate::chat::SoupChat;
use crate::comms::SoupChannel;
use crate::document::SoupDocument;
use crate::email_thread::SoupEnrichedEmailThreadPreview;
use crate::project::SoupProject;

/// A notification in the Soup feed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupNotification {
    /// The notification ID.
    pub id: Uuid,
    /// The user who owns this notification.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,
    /// The notification event type string (for example, `channel_mention`).
    pub event_type: String,
    /// The type of source entity this notification is about.
    pub source_entity_type: EntityType,
    /// The ID of the source entity this notification is about.
    pub source_entity_id: String,
    /// Whether the notification has been sent.
    pub sent: bool,
    /// Whether the notification is marked as done.
    pub done: bool,
    /// When the notification was created for this user.
    pub created_at: DateTime<Utc>,
    /// When the notification was viewed/seen by this user.
    pub viewed_at: Option<DateTime<Utc>>,
    /// When the notification was last updated for this user.
    pub updated_at: DateTime<Utc>,
    /// When the notification was deleted for this user.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Raw notification metadata.
    pub metadata: serde_json::Value,
    /// The user who triggered the notification.
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub sender_id: Option<MacroUserIdStr<'static>>,
    /// The enriched source entity, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SoupNotificationSource>,
}

impl SoupNotification {
    /// Returns the source entity reference for this notification.
    pub fn source_entity(&self) -> Entity<'_> {
        self.source_entity_type
            .with_entity_str(&self.source_entity_id)
    }

    /// Returns an owned source entity reference for this notification.
    pub fn source_entity_owned(&self) -> Entity<'static> {
        self.source_entity_type
            .with_entity_string(self.source_entity_id.clone())
    }

    /// Converts the source entity to an [`EntityReference`] for property lookups.
    pub fn to_entity_reference(&self) -> Option<EntityReference> {
        if let Some(source) = &self.source {
            return source.to_entity_reference();
        }

        entity_reference(self.source_entity_type, &self.source_entity_id)
    }
}

/// The enriched source entity for a [`SoupNotification`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", tag = "tag", content = "data")]
pub enum SoupNotificationSource {
    Document(SoupDocument),
    Chat(SoupChat),
    Project(SoupProject),
    EmailThread(SoupEnrichedEmailThreadPreview),
    Channel(SoupChannel),
    Call(SoupCallRecord),
}

impl SoupNotificationSource {
    /// Returns the entity reference for this source.
    pub fn entity(&self) -> Entity<'static> {
        match self {
            SoupNotificationSource::Document(document) => {
                EntityType::Document.with_entity_string(document.id.to_string())
            }
            SoupNotificationSource::Chat(chat) => {
                EntityType::Chat.with_entity_string(chat.id.to_string())
            }
            SoupNotificationSource::Project(project) => {
                EntityType::Project.with_entity_string(project.id.to_string())
            }
            SoupNotificationSource::EmailThread(email_thread) => {
                EntityType::EmailThread.with_entity_string(email_thread.thread.id.to_string())
            }
            SoupNotificationSource::Channel(channel) => {
                EntityType::Channel.with_entity_string(channel.channel.channel.id.0.to_string())
            }
            SoupNotificationSource::Call(record) => {
                EntityType::Call.with_entity_string(record.call_id.to_string())
            }
        }
    }

    /// Converts this source to an [`EntityReference`] for property lookups.
    pub fn to_entity_reference(&self) -> Option<EntityReference> {
        match self {
            SoupNotificationSource::Document(document) => Some(EntityReference::new(
                document.id.to_string(),
                document.entity_type(),
            )),
            SoupNotificationSource::Chat(chat) => Some(EntityReference::new(
                chat.id.to_string(),
                PropertiesEntityType::Chat,
            )),
            SoupNotificationSource::Project(project) => Some(EntityReference::new(
                project.id.to_string(),
                PropertiesEntityType::Project,
            )),
            SoupNotificationSource::EmailThread(email_thread) => Some(EntityReference::new(
                email_thread.thread.id.to_string(),
                PropertiesEntityType::Thread,
            )),
            SoupNotificationSource::Channel(_) | SoupNotificationSource::Call(_) => None,
        }
    }
}

fn entity_reference(entity_type: EntityType, entity_id: &str) -> Option<EntityReference> {
    let property_entity_type = match entity_type {
        EntityType::Document => PropertiesEntityType::Document,
        EntityType::Chat => PropertiesEntityType::Chat,
        EntityType::Project => PropertiesEntityType::Project,
        EntityType::EmailThread => PropertiesEntityType::Thread,
        EntityType::User
        | EntityType::Channel
        | EntityType::Team
        | EntityType::Call
        | EntityType::StaticFile => return None,
    };

    Some(EntityReference::new(
        entity_id.to_string(),
        property_entity_type,
    ))
}
