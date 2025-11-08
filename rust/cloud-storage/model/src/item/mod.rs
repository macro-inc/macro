use super::{chat::Chat, document::BasicDocument};
use crate::project::Project;
use models_pagination::Identify;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize, Serializer};
use std::cmp::Ordering;
use strum::EnumString;
use utoipa::ToSchema;

pub mod map_item;

#[derive(Debug, Clone, Eq, PartialEq, ToSchema, EnumString, Deserialize, Serialize)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CloudStorageItemType {
    Document,
    Chat,
    Project,
}

#[derive(Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(untagged)]
#[schema(discriminator(property_name = "type", mapping(
     ("document" = "#/components/schemas/BasicDocument"),
     ("chat" = "#/components/schemas/Chat"),
     ("project" = "#/components/schemas/Project"),
)))]
pub enum Item {
    Document(BasicDocument),
    Chat(Chat),
    Project(Project),
}

impl Serialize for Item {
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
            Item::Document(doc) => {
                flatten_variant!(
                    &CloudStorageItemType::Document,
                    CloudStorageItemType,
                    BasicDocument,
                    doc
                )
            }
            Item::Chat(chat) => flatten_variant!(
                &CloudStorageItemType::Chat,
                CloudStorageItemType,
                Chat,
                chat
            ),
            Item::Project(project) => {
                flatten_variant!(
                    &CloudStorageItemType::Project,
                    CloudStorageItemType,
                    Project,
                    project
                )
            }
        }
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
