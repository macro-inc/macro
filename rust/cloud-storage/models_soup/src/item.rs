use crate::call_record::SoupCallRecord;
use crate::document::SoupDocument;
use crate::email_thread::SoupEnrichedEmailThreadPreview;
use crate::project::SoupProject;
use crate::{chat::SoupChat, comms::SoupChannel};
use chrono::{DateTime, Utc};
use model_entity::{Entity, EntityType};
use models_pagination::{Identify, SimpleSortMethod, SortOn};
use models_properties::{EntityReference, EntityType as PropertiesEntityType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", tag = "tag", content = "data")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum SoupItem {
    Document(SoupDocument),
    Chat(SoupChat),
    Project(SoupProject),
    EmailThread(SoupEnrichedEmailThreadPreview),
    Channel(SoupChannel),
    CallRecord(SoupCallRecord),
}

impl SoupItem {
    /// return the [Entity] for this soup item
    pub fn entity(&self) -> Entity<'static> {
        match self {
            SoupItem::Document(soup_document) => {
                EntityType::Document.with_entity_string(soup_document.id.to_string())
            }
            SoupItem::Chat(soup_chat) => {
                EntityType::Chat.with_entity_string(soup_chat.id.to_string())
            }
            SoupItem::Project(soup_project) => {
                EntityType::Project.with_entity_string(soup_project.id.to_string())
            }
            SoupItem::EmailThread(email_thread) => {
                EntityType::EmailThread.with_entity_string(email_thread.thread.id.to_string())
            }
            SoupItem::Channel(channel) => {
                EntityType::Channel.with_entity_string(channel.channel.channel.id.0.to_string())
            }
            SoupItem::CallRecord(record) => {
                EntityType::Call.with_entity_string(record.call_id.to_string())
            }
        }
    }

    pub fn updated_at(&self) -> DateTime<Utc> {
        match self {
            SoupItem::Document(soup_document) => soup_document.updated_at,
            SoupItem::Chat(soup_chat) => soup_chat.updated_at,
            SoupItem::Project(soup_project) => soup_project.updated_at,
            SoupItem::EmailThread(soup_thread) => soup_thread.thread.updated_at,
            SoupItem::Channel(soup_channel) => soup_channel.channel.channel.updated_at,
            SoupItem::CallRecord(record) => record.ended_at.unwrap_or(record.started_at),
        }
    }
}

impl SoupItem {
    fn cursor_timestamp(&self, sort: SimpleSortMethod) -> DateTime<Utc> {
        match (self, sort) {
            (SoupItem::Document(soup_document), SimpleSortMethod::ViewedAt) => {
                soup_document.viewed_at.unwrap_or_default()
            }
            (SoupItem::Document(soup_document), SimpleSortMethod::UpdatedAt) => {
                soup_document.updated_at
            }
            (SoupItem::Document(soup_document), SimpleSortMethod::CreatedAt) => {
                soup_document.created_at
            }
            (SoupItem::Document(soup_document), SimpleSortMethod::ViewedUpdated) => {
                soup_document.viewed_at.unwrap_or(soup_document.updated_at)
            }
            (SoupItem::Chat(soup_chat), SimpleSortMethod::ViewedAt) => {
                soup_chat.viewed_at.unwrap_or_default()
            }
            (SoupItem::Chat(soup_chat), SimpleSortMethod::UpdatedAt) => soup_chat.updated_at,
            (SoupItem::Chat(soup_chat), SimpleSortMethod::CreatedAt) => soup_chat.created_at,
            (SoupItem::Chat(soup_chat), SimpleSortMethod::ViewedUpdated) => {
                soup_chat.viewed_at.unwrap_or(soup_chat.updated_at)
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::ViewedAt) => {
                soup_project.viewed_at.unwrap_or_default()
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::UpdatedAt) => {
                soup_project.updated_at
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::CreatedAt) => {
                soup_project.created_at
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::ViewedUpdated) => {
                soup_project.viewed_at.unwrap_or(soup_project.updated_at)
            }
            (SoupItem::EmailThread(thread), _) => {
                // Always use sort_ts for emails — this is the pre-computed effective_ts
                // from the email SQL query, which is also what the cursor offset logic
                // uses: (effective_ts, id) < (cursor_ts, cursor_id).
                thread.thread.sort_ts
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::ViewedAt) => {
                soup_channel.viewed_at.unwrap_or_default()
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::UpdatedAt) => {
                soup_channel.channel.channel.updated_at
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::CreatedAt) => {
                soup_channel.channel.channel.created_at
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::ViewedUpdated) => soup_channel
                .viewed_at
                .unwrap_or(soup_channel.channel.channel.updated_at),
            (SoupItem::CallRecord(record), SimpleSortMethod::CreatedAt) => record.started_at,
            (SoupItem::CallRecord(record), _) => record.ended_at.unwrap_or(record.started_at),
        }
    }
}

impl Identify for SoupItem {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        match self {
            SoupItem::Document(soup_document) => soup_document.id,
            SoupItem::Chat(soup_chat) => soup_chat.id,
            SoupItem::Project(soup_project) => soup_project.id,
            SoupItem::EmailThread(thread) => thread.thread.id,
            SoupItem::Channel(soup_channel) => soup_channel.channel.channel.id.0,
            SoupItem::CallRecord(record) => record.call_id,
        }
    }
}

impl SortOn<SimpleSortMethod> for SoupItem {
    fn sort_on(
        sort: SimpleSortMethod,
    ) -> impl FnMut(&Self) -> models_pagination::CursorVal<SimpleSortMethod> {
        move |v| {
            let last_val = v.cursor_timestamp(sort);
            models_pagination::CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}

impl SoupItem {
    /// Converts this item to an [`EntityReference`] for property lookups.
    ///
    /// Returns `None` for item types that don't support properties (e.g., channels).
    pub fn to_entity_reference(&self) -> Option<EntityReference> {
        match self {
            SoupItem::Document(doc) => {
                Some(EntityReference::new(doc.id.to_string(), doc.entity_type()))
            }
            SoupItem::Project(p) => Some(EntityReference::new(
                p.id.to_string(),
                PropertiesEntityType::Project,
            )),
            SoupItem::EmailThread(e) => Some(EntityReference::new(
                e.thread.id.to_string(),
                PropertiesEntityType::Thread,
            )),
            SoupItem::Chat(c) => Some(EntityReference::new(
                c.id.to_string(),
                PropertiesEntityType::Chat,
            )),
            SoupItem::Channel(_) => None,
            SoupItem::CallRecord(_) => None,
        }
    }
}
