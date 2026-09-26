//! Project lifecycle tools.

use super::*;
use crate::domain::models::{CreateInitiativeRequest, UpdateInitiativeRequest};
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel};
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

/// Create a project with the same defaults as the application.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateInitiative",
    description = "Create a project for coordinating tasks (called an initiative in the API). Projects have status, priority, assignees, due dates, discussions and activity. Shares with the owner's team by default. This is different from CreateProject, which creates a folder. Use property tools with entityType initiative to set project properties."
)]
pub struct CreateInitiative {
    /// Project name, up to 100 graphemes.
    #[schemars(description = "Project name, up to 100 graphemes.")]
    pub name: String,
    /// Initial Markdown description, up to 2000 graphemes; optional.
    #[schemars(description = "Initial Markdown description, up to 2000 graphemes; optional.")]
    pub description: Option<String>,
    /// Users to grant collaboration access; distinct from property assignees.
    #[schemars(
        description = "Users to grant collaboration access; distinct from property assignees."
    )]
    pub member_ids: Option<Vec<String>>,
    /// Defaults to true. False creates without an explicit team grant.
    #[schemars(description = "Defaults to true. False creates without an explicit team grant.")]
    pub share_with_team: Option<bool>,
}

impl ToolAnnotated for CreateInitiative {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create project");
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for CreateInitiative
{
    type Output = ProjectDetails;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .create_attributed(
                &request.user_id,
                CreateInitiativeRequest {
                    name: self.name.clone(),
                    description: self.description.clone(),
                    member_ids: self.member_ids.clone(),
                    share_with_team: self.share_with_team,
                },
                activity::Attribution::delegated(
                    activity::Actor::new_from_bot(context.actor),
                    request.user_id.clone(),
                ),
            )
            .await
            .map(Into::into)
            .map_err(failure)
    }
}

/// Rename a project or change its collaboration members.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateInitiative",
    description = "Rename a project with edit access, or replace its collaboration member list as the owner. Members control sharing independently of the assignee property. Assigning a user grants collaboration access; removing an assignment retains that access. For status, priority, assignees and due date use SetEntityProperty with entityType initiative. ReadInitiative returns the description document id for document editing tools."
)]
pub struct UpdateInitiative {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Replacement name; omitted leaves it unchanged.
    #[schemars(description = "Replacement name; omitted leaves it unchanged.")]
    pub name: Option<String>,
    /// Owner-only complete replacement member list; omitted preserves existing members, [] clears it.
    #[schemars(
        description = "Owner-only complete replacement member list; omitted preserves existing members, [] clears it."
    )]
    pub member_ids: Option<Vec<String>>,
}

impl ToolAnnotated for UpdateInitiative {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Update project").with_idempotent();
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for UpdateInitiative
{
    type Output = ProjectDetails;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<EditAccessLevel>(
                &request,
                &self.initiative_id.to_string(),
                EntityType::Initiative,
            )
            .await?;
        context
            .service
            .update(
                receipt,
                UpdateInitiativeRequest {
                    name: self.name.clone(),
                    member_ids: self.member_ids.clone(),
                    share_permission: None,
                },
            )
            .await
            .map(Into::into)
            .map_err(failure)
    }
}

/// Delete a project and its description while retaining its tasks.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteInitiative",
    description = "Permanently delete a project, its description and project-owned discussions/properties. Associated tasks remain and lose their project association. Requires ownership. This operation cannot be undone."
)]
pub struct DeleteInitiative {
    /// Project to permanently delete.
    #[schemars(description = "Project to permanently delete.")]
    pub initiative_id: Uuid,
}

impl ToolAnnotated for DeleteInitiative {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Delete project");
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for DeleteInitiative
{
    type Output = ProjectOperationComplete;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<OwnerAccessLevel>(
                &request,
                &self.initiative_id.to_string(),
                EntityType::Initiative,
            )
            .await?;
        context.service.delete(receipt).await.map_err(failure)?;
        Ok(ProjectOperationComplete { success: true })
    }
}
