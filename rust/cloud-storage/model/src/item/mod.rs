use super::{chat::Chat, document::BasicDocument};
use crate::project::Project;
use models_pagination::Identify;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use strum::EnumString;
use utoipa::openapi::Discriminator;
use utoipa::{PartialSchema, ToSchema};

pub mod map_item;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Eq, PartialEq, ToSchema, EnumString, Deserialize, Serialize)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CloudStorageItemType {
    Document,
    Chat,
    Project,
}

#[derive(Deserialize, Serialize, Eq, PartialEq, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Item {
    Document(BasicDocument),
    Chat(Chat),
    Project(Project),
}

// manually implemented ToSchema
//      - gen better frontend types by referencing subschemas
//      - can deserialize / serialize in rust
impl ToSchema for Item {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::from("Item")
    }

    fn schemas(
        schemas: &mut Vec<(
            String,
            utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>,
        )>,
    ) {
        schemas.push((BasicDocument::name().into(), BasicDocument::schema()));
        schemas.push((Chat::name().into(), Chat::schema()));
        schemas.push((Project::name().into(), Project::schema()));
        <BasicDocument as ToSchema>::schemas(schemas);
        <Chat as ToSchema>::schemas(schemas);
        <Project as ToSchema>::schemas(schemas);
    }
}

impl PartialSchema for Item {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::Schema::OneOf(
            utoipa::openapi::OneOfBuilder::new()
                .discriminator(Some(Discriminator {
                    extensions: None,
                    property_name: "type".into(),
                    mapping: [
                        ("document", "#/components/schemas/BasicDocument"),
                        ("chat", "#/components/schemas/Chat"),
                        ("project", "#/components/schemas/Project"),
                    ]
                    .into_iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
                }))
                .item(utoipa::openapi::Ref::from_schema_name("BasicDocument"))
                .item(utoipa::openapi::Ref::from_schema_name("Chat"))
                .item(utoipa::openapi::Ref::from_schema_name("Project"))
                .build(),
        )
        .into()
    }
}

impl PartialOrd for Item {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Item {
    fn cmp(&self, other: &Self) -> Ordering {
        let self_date = match self {
            Item::Document(doc) => &doc.updated_at,
            Item::Chat(chat) => &chat.updated_at,
            Item::Project(project) => &project.updated_at,
        };
        let other_date = match other {
            Item::Document(doc) => &doc.updated_at,
            Item::Chat(chat) => &chat.updated_at,
            Item::Project(project) => &project.updated_at,
        };
        self_date.cmp(other_date)
    }
}

impl From<Project> for Item {
    fn from(val: Project) -> Self {
        Item::Project(val)
    }
}

impl From<BasicDocument> for Item {
    fn from(val: BasicDocument) -> Self {
        Item::Document(val)
    }
}

impl From<Chat> for Item {
    fn from(val: Chat) -> Self {
        Item::Chat(val)
    }
}

impl Identify for Item {
    type Id = String;
    fn id(&self) -> String {
        // We match on the enum variant and return the correct ID field, cloning it to
        // create a new String.
        match self {
            Item::Document(doc) => doc.document_id.clone(),
            Item::Chat(chat) => chat.id.clone(),
            Item::Project(project) => project.id.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemWithUserAccessLevel {
    pub item: Item,
    pub user_access_level: AccessLevel,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemWithSharePermission {
    pub item: Item,
    pub share_permission: models_permissions::share_permission::SharePermissionV2,
}

#[derive(Debug, Deserialize, Serialize, ToSchema, Clone, Hash)]
pub struct UserAccessibleItem {
    pub item_id: String,
    pub item_type: String,
}

/// represents all of the types of items that have share permissions.
#[derive(Debug, Deserialize, Serialize, ToSchema, Clone, EnumString, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ShareableItemType {
    Document,
    Chat,
    Project,
    Thread,
}

/// represents a shareable item with its id and type
#[derive(Debug, Deserialize, Serialize, ToSchema, Clone)]
pub struct ShareableItem {
    pub item_id: String,
    pub item_type: ShareableItemType,
}
