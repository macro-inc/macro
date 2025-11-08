use crate::chat::SoupChat;
use crate::document::SoupDocument;
use crate::project::SoupProject;
use chrono::{DateTime, Utc};
use model_entity::{Entity, EntityType};
use models_pagination::{Identify, SimpleSortMethod, SortOn};
use serde::{Deserialize, Serialize, Serializer};
use strum::EnumString;
use utoipa::ToSchema;

#[derive(Debug, Clone, Eq, PartialEq, ToSchema, EnumString, Deserialize, Serialize)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum SoupItemType {
    Document,
    Chat,
    Project,
}

#[derive(Deserialize, Clone, ToSchema, Debug)]
#[serde(untagged)]
#[schema(discriminator(property_name = "type", mapping(
     ("document" = "#/components/schemas/SoupDocument"),
     ("chat" = "#/components/schemas/SoupChat"),
     ("project" = "#/components/schemas/SoupProject"),
)))]
pub enum SoupItem {
    Document(SoupDocument),
    Chat(SoupChat),
    Project(SoupProject),
}

impl SoupItem {
    /// return the [Entity] for this soup item
    pub fn entity(&self) -> Entity<'_> {
        match self {
            SoupItem::Document(soup_document) => {
                EntityType::Document.with_entity_str(&soup_document.id)
            }
            SoupItem::Chat(soup_chat) => EntityType::Chat.with_entity_str(&soup_chat.id),
            SoupItem::Project(soup_project) => {
                EntityType::Project.with_entity_str(&soup_project.id)
            }
        }
    }

    pub fn updated_at(&self) -> DateTime<Utc> {
        match self {
            SoupItem::Document(soup_document) => soup_document.updated_at,
            SoupItem::Chat(soup_chat) => soup_chat.updated_at,
            SoupItem::Project(soup_project) => soup_project.updated_at,
        }
    }
}

impl Serialize for SoupItem {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        macro_rules! flatten_variant {
            ($tag:expr, $tag_ty:ty, $inner_ty:ty, $inner_val:expr) => {{
                #[derive(Serialize)]
                struct Inline<'a> {
                    #[serde(rename = "type")]
                    tag: &'a $tag_ty,
                    #[serde(flatten)]
                    data: &'a $inner_ty,
                }
                let tmp = Inline {
                    tag: $tag,
                    data: $inner_val,
                };
                tmp.serialize(serializer)
            }};
        }

        match self {
            SoupItem::Document(doc) => {
                flatten_variant!(&SoupItemType::Document, SoupItemType, SoupDocument, doc)
            }
            SoupItem::Chat(chat) => {
                flatten_variant!(&SoupItemType::Chat, SoupItemType, SoupChat, chat)
            }
            SoupItem::Project(project) => {
                flatten_variant!(&SoupItemType::Project, SoupItemType, SoupProject, project)
            }
        }
    }
}

impl From<SoupProject> for SoupItem {
    fn from(val: SoupProject) -> Self {
        SoupItem::Project(val)
    }
}

impl From<SoupDocument> for SoupItem {
    fn from(val: SoupDocument) -> Self {
        SoupItem::Document(val)
    }
}

impl From<SoupChat> for SoupItem {
    fn from(val: SoupChat) -> Self {
        SoupItem::Chat(val)
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
        }
    }
}

impl Identify for SoupItem {
    type Id = String;

    fn id(&self) -> Self::Id {
        match self {
            SoupItem::Document(soup_document) => soup_document.id.clone(),
            SoupItem::Chat(soup_chat) => soup_chat.id.clone(),
            SoupItem::Project(soup_project) => soup_project.id.clone(),
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
