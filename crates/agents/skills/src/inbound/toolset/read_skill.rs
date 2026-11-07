use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::SkillToolContext;
use crate::domain::ports::SkillService;

/// Read complete instructions for a skill discovered in Macro.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadSkill",
    description = "Read a skill's complete markdown instructions by its documentId from ListSkills or SearchSkills, or a skill mention. Supports user-authored and built-in skills. Read a relevant skill before performing the task and follow its instructions for that request. Returns the skill name and full content; only skill documents the user can view are readable."
)]
pub struct ReadSkill {
    /// The skill id returned by discovery or supplied in a skill mention.
    #[schemars(
        description = "The documentId returned by ListSkills or SearchSkills, or the id of a mentioned skill."
    )]
    pub document_id: Uuid,
}

/// Complete skill instructions returned to any harness.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadSkillResponse {
    /// The skill id.
    pub document_id: Uuid,
    /// The skill's display name.
    pub name: String,
    /// Full markdown instructions to follow for the invoking request.
    pub content: String,
}

impl ToolAnnotated for ReadSkill {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read skill");
}

#[async_trait]
impl<Svc: SkillService> AsyncTool<SkillToolContext<Svc>> for ReadSkill {
    type Output = ReadSkillResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SkillToolContext<Svc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let skill = service_context
            .service
            .read_skill(&request_context.user_id, self.document_id)
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: error.into(),
            })?;
        Ok(ReadSkillResponse {
            document_id: skill.document_id,
            name: skill.name,
            content: skill.content,
        })
    }
}
