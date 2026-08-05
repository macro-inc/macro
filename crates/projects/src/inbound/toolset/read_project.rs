//! ReadProject tool for listing a project's (folder's) contents.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::models::ViewAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::MoveEntity;
use model::item::Item;
use model_entity::EntityType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ProjectToolContext;
use crate::domain::ports::ProjectService;

/// The kind of an item inside a project.
#[derive(Debug, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectItemType {
    /// A document (includes tasks).
    Document,
    /// An AI chat conversation.
    Chat,
    /// A nested project.
    Project,
}

/// A single item inside a project.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItem {
    /// The id of the item.
    pub id: String,
    /// The kind of the item.
    pub item_type: ProjectItemType,
    /// The display name of the item.
    pub name: String,
    /// The file type, for documents (e.g. md, pdf, docx).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// When the item was last updated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<Item> for ProjectItem {
    fn from(item: Item) -> Self {
        match item {
            Item::Document(document) => Self {
                id: document.document_id,
                item_type: ProjectItemType::Document,
                name: document.document_name,
                file_type: document.file_type,
                updated_at: document.updated_at,
            },
            Item::Chat(chat) => Self {
                id: chat.id,
                item_type: ProjectItemType::Chat,
                name: chat.name,
                file_type: None,
                updated_at: chat.updated_at,
            },
            Item::Project(project) => Self {
                id: project.id,
                item_type: ProjectItemType::Project,
                name: project.name,
                file_type: None,
                updated_at: project.updated_at,
            },
        }
    }
}

/// The read project response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectResponse {
    /// The id of the project.
    pub project_id: uuid::Uuid,
    /// The name of the project.
    pub project_name: String,
    /// The id of the parent project, if this project is nested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_project_id: Option<String>,
    /// The project's direct children in display order.
    pub items: Vec<ProjectItem>,
}

/// ReadProject tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadProject",
    description = "List the direct contents of a project (shown as a folder in the app UI): its documents, AI chats, and nested projects. Requires view access to the project. Email threads filed into the project are not included."
)]
pub struct ReadProject {
    /// The id of the project to read.
    #[schemars(description = "The id of the project to read.")]
    pub project_id: uuid::Uuid,
}

#[async_trait]
impl<PSvc, ESvc, DSvc, CSvc, EmSvc> AsyncTool<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>
    for ReadProject
where
    PSvc: ProjectService + MoveEntity,
    ESvc: EntityAccessService,
    DSvc: MoveEntity + Send + Sync + 'static,
    CSvc: MoveEntity + Send + Sync + 'static,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    type Output = ReadProjectResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, project_id=?self.project_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Read project");

        let project_id = self.project_id.to_string();

        let entity_access_receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &request_context.user_id,
                None,
                &project_id,
                EntityType::Project,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "you do not have access to this project, or it does not exist"
                    .to_string(),
                internal_error: e.into(),
            })?;

        // SAFETY: This is allowed because the user has view access from the receipt above.
        let project = service_context
            .service
            .internal_get_basic_project(&project_id)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the project".to_string(),
                internal_error: e.into(),
            })?;

        if project.deleted_at.is_some() {
            return Err(ToolCallError {
                description: "cannot read a deleted project".to_string(),
                internal_error: anyhow::anyhow!("project {project_id} is deleted"),
            });
        }

        let items = service_context
            .service
            .get_project_content(entity_access_receipt)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to read the project's contents".to_string(),
                internal_error: e.into(),
            })?;

        Ok(ReadProjectResponse {
            project_id: self.project_id,
            project_name: project.name,
            parent_project_id: project.parent_id,
            items: items
                .into_iter()
                .map(|item| ProjectItem::from(item.item))
                .collect(),
        })
    }
}
