use crate::chat::SoupChat;
use crate::document::SoupDocument;
use crate::email_thread::SoupEnrichedEmailThreadPreview;
use crate::project::SoupProject;
use chrono::{DateTime, Utc};
use model_entity::{Entity, EntityType};
use models_pagination::{Identify, SimpleSortMethod, SortOn};
use serde::{Deserialize, Serialize};
use strum::EnumString;
use uuid::Uuid;

#[derive(Debug, Clone, Eq, PartialEq, EnumString, Deserialize, Serialize)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum SoupItemType {
    Document,
    Chat,
    Project,
    EmailThread,
}

#[derive(Serialize, Deserialize, Debug)]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[serde(rename_all = "camelCase", tag = "tag", content = "data")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum SoupItem {
    Document(SoupDocument),
    Chat(SoupChat),
    Project(SoupProject),
    EmailThread(SoupEnrichedEmailThreadPreview),
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
        }
    }

    pub fn updated_at(&self) -> DateTime<Utc> {
        match self {
            SoupItem::Document(soup_document) => soup_document.updated_at,
            SoupItem::Chat(soup_chat) => soup_chat.updated_at,
            SoupItem::Project(soup_project) => soup_project.updated_at,
            SoupItem::EmailThread(soup_thread) => soup_thread.thread.updated_at,
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
            (SoupItem::EmailThread(thread), SimpleSortMethod::ViewedAt) => {
                thread.thread.viewed_at.unwrap_or_default()
            }
            (SoupItem::EmailThread(thread), SimpleSortMethod::UpdatedAt) => {
                thread.thread.updated_at
            }
            (SoupItem::EmailThread(thread), SimpleSortMethod::CreatedAt) => {
                thread.thread.created_at
            }
            (SoupItem::EmailThread(thread), SimpleSortMethod::ViewedUpdated) => {
                thread.thread.viewed_at.unwrap_or(thread.thread.updated_at)
            }
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
        }
    }
}

impl SortOn<SimpleSortMethod> for SoupItem {
    fn sort_on(
        sort: SimpleSortMethod,
    ) -> impl FnOnce(&Self) -> models_pagination::CursorVal<SimpleSortMethod> {
        move |v| {
            let last_val = v.cursor_timestamp(sort);
            models_pagination::CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}
