//! CreateSkill tool for writing a new skill document.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, EntityType};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::DocumentToolContext;
use crate::domain::create::{MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument};
use crate::domain::models::DocumentError;
use crate::domain::ports::{
    DocumentService, create::DocumentCreationService, editing::EditingWorkerService,
};

/// The created skill.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkillResponse {
    /// The id of the skill document.
    pub document_id: Uuid,
}

#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateSkill",
    description = "Create a skill: a markdown document of reusable instructions that AI reads and follows when the skill is referenced, as Compose Skill in the app does. Write the instructions as the markdown body. Edit an existing skill with EditDocument; find skills with ListSkills or SearchSkills."
)]
pub struct CreateSkill {
    #[schemars(description = "The skill's name.")]
    pub skill_name: String,

    #[schemars(description = "The skill's instructions, in markdown.")]
    pub markdown: String,

    #[schemars(
        description = "The id of the project (shown as a folder in the app UI) to create the skill in. Requires edit access to the project. Omit to create it at the top level of the user's files."
    )]
    #[serde(default)]
    pub project_id: Option<Uuid>,
}

impl ToolAnnotated for CreateSkill {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create skill");
}

fn failed_to_create_skill(error: DocumentError) -> ToolCallError {
    let description = match &error {
        DocumentError::BadRequest(message) => message.clone(),
        DocumentError::NameTooLong { max } => format!("name too long (max {max} characters)"),
        _ => "failed to create the skill".to_string(),
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for CreateSkill
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = CreateSkillResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let skill_name = self.skill_name.trim();
        if skill_name.is_empty() {
            return Err(ToolCallError {
                description: "skillName must not be empty".to_string(),
                internal_error: anyhow::anyhow!("empty skill name"),
            });
        }
        // Mirrors the create_skill route's project body extractor.
        if let Some(project_id) = self.project_id {
            service_context
                .entity_access_service
                .generate_entity_access_receipt::<EditAccessLevel>(
                    &request_context.user_id,
                    None,
                    &project_id.to_string(),
                    EntityType::Project,
                )
                .await
                .map_err(|error| ToolCallError {
                    description: "you need edit access to the target project, or it does not exist"
                        .to_string(),
                    internal_error: error.into(),
                })?;
        }

        let mut metadata = NewDocumentMetadata::builder(skill_name.to_string());
        if let Some(project_id) = self.project_id {
            metadata = metadata.project_id(project_id);
        }
        let principal = service_context.creation_principal(request_context.user_id.clone());
        let created = service_context
            .creator
            .create_markdown_text(
                &principal,
                NewMarkdownTextDocument {
                    metadata: metadata.build(),
                    markdown: self.markdown.clone(),
                    subtype: MarkdownSubtype::Skill,
                },
            )
            .await
            .map_err(failed_to_create_skill)?;
        let document_id =
            Uuid::parse_str(created.document_id()).map_err(|error| ToolCallError {
                description: "the skill was created but returned an invalid id".to_string(),
                internal_error: error.into(),
            })?;

        Ok(CreateSkillResponse { document_id })
    }
}
