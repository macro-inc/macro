//! ListTags tool for reading the tags available to the caller.

use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_properties::PropertyOwner;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::tag_sets::TagScope;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::PropertiesToolContext;

/// A single tag in a tag set.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTag {
    /// The tag's option id. Use it with SetEntityProperty to apply or remove the tag.
    pub id: Uuid,
    /// The tag's human-readable label.
    pub label: String,
    /// The tag's display color, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// One tag set available to the caller.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTagSet {
    /// Whether this is the caller's personal set or a team set.
    pub scope: TagScope,
    /// The tag property definition id. Use it as propertyDefinitionId when
    /// calling SetEntityProperty to apply or remove one of this set's tags.
    pub property_definition_id: Uuid,
    /// The tags in this set.
    pub tags: Vec<ToolTag>,
}

/// Response from [`ListTags`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTagsResponse {
    /// The tag sets available to the caller.
    pub tag_sets: Vec<ToolTagSet>,
    /// Human-readable summary.
    pub summary: String,
}

/// List the tags available to the caller.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[schemars(
    title = "ListTags",
    description = "List the tags available to the user: their personal tag set plus their team's set when they belong to a team. Each tag has a human-readable label, an option id, and optionally a color. Refer to tags by label when talking to the user. To filter items by tag, pass the labels to the tags argument of ListEntities, ContentSearch, or NameSearch. To apply or remove a tag on an entity, call SetEntityProperty with the set's propertyDefinitionId and the tag's option id in add_option_ids or remove_option_ids — never rewrite the full value to add or remove one tag. Call this before tag operations when you don't already know the user's tags."
)]
#[allow(unused)]
// empty structs can't be deserialized;
pub struct ListTags {}

#[async_trait]
impl<T, A> AsyncTool<PropertiesToolContext<T, A>> for ListTags
where
    T: PropertiesService,
    A: EntityAccessService,
{
    type Output = ListTagsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<PropertiesToolContext<T, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List tags");

        let definitions = service_context
            .service
            .list_caller_tag_sets(request_context.user_id.as_ref())
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to list tags: {e}"),
                internal_error: e.into(),
            })?;

        let mut tag_sets: Vec<ToolTagSet> = definitions
            .into_iter()
            .filter_map(|def| {
                let scope = match def.definition.owner {
                    PropertyOwner::User { .. } => TagScope::Personal,
                    PropertyOwner::Team { .. } => TagScope::Team,
                    PropertyOwner::System => return None,
                };
                let tags = def
                    .property_options
                    .into_iter()
                    .map(|option| ToolTag {
                        id: option.id,
                        label: match option.value {
                            PropertyOptionValue::String(s) => s,
                            PropertyOptionValue::Number(n) => n.to_string(),
                        },
                        color: option.color,
                    })
                    .collect();
                Some(ToolTagSet {
                    scope,
                    property_definition_id: def.definition.id,
                    tags,
                })
            })
            .collect();
        tag_sets.sort_by_key(|set| set.scope != TagScope::Personal);

        let tag_count: usize = tag_sets.iter().map(|set| set.tags.len()).sum();
        let summary = if tag_count == 0 {
            "The user has no tags yet.".to_string()
        } else {
            format!(
                "Found {tag_count} tag{} across {} set{}.",
                if tag_count == 1 { "" } else { "s" },
                tag_sets.len(),
                if tag_sets.len() == 1 { "" } else { "s" },
            )
        };

        Ok(ListTagsResponse { tag_sets, summary })
    }
}
