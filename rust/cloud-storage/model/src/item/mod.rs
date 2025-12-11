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

#[cfg(test)]
mod test {
    use super::*;
    use utoipa::ToSchema;
    #[test]
    fn test_reference() {
        let schema = Item::schema();

        match schema {
            utoipa::openapi::RefOr::T(utoipa::openapi::Schema::OneOf(one_of)) => {
                let discriminator = one_of
                    .discriminator
                    .as_ref()
                    .expect("Discriminator should exist");
                assert_eq!(discriminator.property_name, "type");

                assert_eq!(discriminator.mapping.len(), 3);
                assert_eq!(
                    discriminator.mapping.get("document"),
                    Some(&"#/components/schemas/BasicDocument".to_string())
                );
                assert_eq!(
                    discriminator.mapping.get("chat"),
                    Some(&"#/components/schemas/Chat".to_string())
                );
                assert_eq!(
                    discriminator.mapping.get("project"),
                    Some(&"#/components/schemas/Project".to_string())
                );

                // Check that we have exactly 3 items in the OneOf
                assert_eq!(one_of.items.len(), 3);

                let refs: Vec<String> = one_of
                    .items
                    .iter()
                    .filter_map(|item| match item {
                        utoipa::openapi::RefOr::Ref(r) => Some(r.ref_location.clone()),
                        _ => None,
                    })
                    .collect();

                assert!(refs.contains(&"#/components/schemas/BasicDocument".to_string()));
                assert!(refs.contains(&"#/components/schemas/Chat".to_string()));
                assert!(refs.contains(&"#/components/schemas/Project".to_string()));
            }
            _ => panic!("Expected OneOf schema"),
        }

        // Verify that schemas() includes all subschemas
        let mut schemas = Vec::new();
        Item::schemas(&mut schemas);

        let schema_names: Vec<String> = schemas.iter().map(|(name, _)| name.clone()).collect();
        assert!(schema_names.contains(&"BasicDocument".to_string()));
        assert!(schema_names.contains(&"Chat".to_string()));
        assert!(schema_names.contains(&"Project".to_string()));
    }

    #[test]
    fn test_document_serde() {
        let doc = BasicDocument {
            document_id: "doc123".to_string(),
            document_version_id: 1,
            owner: "user1".to_string(),
            document_name: "Test Document".to_string(),
            file_type: Some("pdf".to_string()),
            sha: Some("abc123".to_string()),
            project_id: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            created_at: Some(chrono::Utc::now()),
            updated_at: Some(chrono::Utc::now()),
            deleted_at: None,
            sub_type: None,
        };

        let item = Item::Document(doc.clone());

        let json = serde_json::to_string(&item).expect("Serialization should succeed");

        let deserialized: Item =
            serde_json::from_str(&json).expect("Deserialization should succeed");

        match deserialized {
            Item::Document(d) => {
                assert_eq!(doc.document_id, d.document_id);
                assert_eq!(doc.document_name, d.document_name);
            }
            _ => panic!("expected document"),
        }
    }

    #[test]
    fn test_chat_serde() {
        let chat = Chat {
            id: "chat123".to_string(),
            name: "Test Chat".to_string(),
            user_id: "user1".to_string(),
            model: Some("claude-3".to_string()),
            project_id: None,
            created_at: Some(chrono::Utc::now()),
            updated_at: Some(chrono::Utc::now()),
            token_count: Some(100),
            is_persistent: true,
            deleted_at: None,
        };

        let item = Item::Chat(chat.clone());
        let json = serde_json::to_string(&item).expect("Serialization should succeed");

        assert!(json.contains("\"type\":\"chat\""));

        let deserialized: Item =
            serde_json::from_str(&json).expect("Deserialization should succeed");

        match deserialized {
            Item::Chat(c) => {
                assert_eq!(chat.id, c.id);
                assert_eq!(chat.name, c.name);
            }
            _ => panic!("expected chat"),
        }
    }

    #[test]
    fn test_project_serde() {
        // Create a sample Project
        let project = Project {
            id: "proj123".to_string(),
            name: "Test Project".to_string(),
            user_id: "user1".to_string(),
            parent_id: None,
            created_at: Some(chrono::Utc::now()),
            updated_at: Some(chrono::Utc::now()),
            deleted_at: None,
        };

        let item = Item::Project(project.clone());
        let json = serde_json::to_string(&item).expect("Serialization should succeed");

        println!("{}", json);
        let deserialized: Item =
            serde_json::from_str(&json).expect("Deserialization should succeed");

        match deserialized {
            Item::Project(p) => {
                assert_eq!(project.id, p.id);
                assert_eq!(project.name, p.name);
            }
            _ => panic!("expecte project"),
        }
    }
}
