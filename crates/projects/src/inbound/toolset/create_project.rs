//! CreateProject tool for creating projects (folders).

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use anyhow::Context;
use async_trait::async_trait;
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::MoveEntity;
use model::project::request::CreateProjectRequest;
use model_entity::EntityType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ProjectToolContext;
use crate::domain::models::ProjectError;
use crate::domain::ports::ProjectService;

fn failed_to_create_project(error: ProjectError) -> ToolCallError {
    let description = match &error {
        ProjectError::BadRequest(message) => message.clone(),
        ProjectError::NameTooLong { max } => {
            format!("name too long (max {max} characters)")
        }
        _ => "failed to create project".to_string(),
    };

    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

/// The create project response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResponse {
    /// The id of the created project.
    pub project_id: uuid::Uuid,
    /// The name of the created project.
    pub project_name: String,
}

/// CreateProject tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateProject",
    description = "Create a project — shown as a folder in the app UI. Documents, AI chats, email threads, and other projects can be placed inside it."
)]
pub struct CreateProject {
    /// The name of the project.
    #[schemars(description = "The name of the project.")]
    pub project_name: String,

    /// The project to nest the new project inside.
    #[schemars(
        description = "The id of an existing project to nest the new project inside. Requires edit access to that project. Omit to create the project at the top level."
    )]
    #[serde(default)]
    pub parent_project_id: Option<uuid::Uuid>,
}

#[async_trait]
impl<PSvc, ESvc, DSvc, CSvc, EmSvc> AsyncTool<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>
    for CreateProject
where
    PSvc: ProjectService + MoveEntity,
    ESvc: EntityAccessService,
    DSvc: MoveEntity + Send + Sync + 'static,
    CSvc: MoveEntity + Send + Sync + 'static,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    type Output = CreateProjectResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Create project");

        let user_id = request_context.user_id.clone();

        // Mirrors the axum route's ProjectBodyAccessLevelExtractorV2: creating
        // inside a parent requires edit access to that parent.
        if let Some(parent_id) = self.parent_project_id {
            service_context
                .entity_access_service
                .generate_entity_access_receipt::<EditAccessLevel>(
                    &user_id,
                    None,
                    &parent_id.to_string(),
                    EntityType::Project,
                )
                .await
                .map_err(|e| ToolCallError {
                    description: "you need edit access to the parent project, or it does not exist"
                        .to_string(),
                    internal_error: e.into(),
                })?;
        }

        let project = service_context
            .service
            .create_project(
                user_id,
                CreateProjectRequest {
                    name: self.project_name.clone(),
                    project_parent_id: self.parent_project_id,
                },
            )
            .await
            .map_err(failed_to_create_project)?;

        let project_id = project
            .id
            .parse()
            .context("expected valid uuid")
            .map_err(|e| ToolCallError {
                description: format!("invalid project id was output {}", project.id),
                internal_error: e,
            })?;

        Ok(CreateProjectResponse {
            project_id,
            project_name: project.name,
        })
    }
}
