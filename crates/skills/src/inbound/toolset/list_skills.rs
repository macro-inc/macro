use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::SkillToolContext;
use super::search_skills::SkillSearchResult;
use crate::domain::ports::SkillService;

/// AI tool input for listing the user's skills.
#[derive(Debug, JsonSchema, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListSkills",
    description = "List the skills the user can access, most recently updated first. Skills are markdown documents containing instructions for AI to read and follow; after finding a relevant skill, read its instructions with ReadContent using the returned document id. Use this to discover what skills exist; when looking for a specific skill by name, prefer SearchSkills."
)]
pub struct ListSkills {}

/// Response for a skill listing.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSkillsResponse {
    /// The user's skills, most recently updated first.
    pub results: Vec<SkillSearchResult>,
}

#[async_trait]
impl<Svc: SkillService> AsyncTool<SkillToolContext<Svc>> for ListSkills {
    type Output = ListSkillsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SkillToolContext<Svc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let skills = service_context
            .service
            .list_skills(&request_context.user_id)
            .await
            .map_err(|error| ToolCallError {
                description: "failed to list skills".to_string(),
                internal_error: error.into(),
            })?;

        Ok(ListSkillsResponse {
            results: skills
                .into_iter()
                .map(|skill| SkillSearchResult {
                    document_id: skill.document_id,
                    name: skill.name,
                    updated_at: skill.updated_at,
                })
                .collect(),
        })
    }
}
