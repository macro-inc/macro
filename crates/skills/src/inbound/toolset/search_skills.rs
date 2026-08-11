use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::SkillToolContext;
use crate::domain::model::{SkillError, SkillMatchType};
use crate::domain::ports::SkillService;

/// How search terms are matched against skill names.
#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SearchSkillsMatchType {
    /// Prefix matching: a single-word term matches tokens that start with it.
    #[default]
    Partial,
    /// Whole-token / exact-phrase matching, no prefix expansion.
    Exact,
}

impl From<SearchSkillsMatchType> for SkillMatchType {
    fn from(value: SearchSkillsMatchType) -> Self {
        match value {
            SearchSkillsMatchType::Partial => SkillMatchType::Partial,
            SearchSkillsMatchType::Exact => SkillMatchType::Exact,
        }
    }
}

/// AI tool input for searching the user's skills by name.
#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "SearchSkills",
    description = "Search the user's skills by name. Skills are markdown documents containing instructions for AI to read and follow; when the user references a skill (or a request matches one), find it with this tool and then read its instructions with ReadContent using the returned document id. This is keyword search against skill names: pass 1-3 targeted keywords that would literally appear in the skill's name, not a natural-language description. Matching defaults to prefix; set matchType to 'exact' for whole-token matching. Only skills the user can access are returned, most recently updated first."
)]
pub struct SearchSkills {
    /// The skill name to search.
    #[schemars(
        description = "The skill name to search. Pass 1-3 keywords drawn from words that would literally appear in the skill's name. The whole query is matched as a single adjacent phrase prefix, so long phrases will not match."
    )]
    pub name: String,

    /// Matching mode for the search terms.
    #[schemars(
        description = "Matching mode. 'partial' (the default) matches each word as a prefix, so `deplo` matches `deploy`. 'exact' matches whole tokens/phrases with no prefix expansion."
    )]
    #[serde(default)]
    pub match_type: SearchSkillsMatchType,
}

/// A skill matched by a skill search.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkillSearchResult {
    /// The document id of the skill. Read the skill's instructions with
    /// ReadContent using this id.
    pub document_id: Uuid,
    /// The name of the skill.
    pub name: String,
    /// When the skill was last updated, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

/// Response for a skill search.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchSkillsResponse {
    /// The matched skills, most recently updated first.
    pub results: Vec<SkillSearchResult>,
}

#[async_trait]
impl<Svc: SkillService> AsyncTool<SkillToolContext<Svc>> for SearchSkills {
    type Output = SearchSkillsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, name=%self.name), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SkillToolContext<Svc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let skills = service_context
            .service
            .search_skills(&request_context.user_id, &self.name, self.match_type.into())
            .await
            .map_err(|error| match error {
                SkillError::InvalidRequest(message) => ToolCallError {
                    description: message.clone(),
                    internal_error: anyhow::anyhow!(message),
                },
                error => ToolCallError {
                    description: "failed to search skills".to_string(),
                    internal_error: error.into(),
                },
            })?;

        Ok(SearchSkillsResponse {
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
