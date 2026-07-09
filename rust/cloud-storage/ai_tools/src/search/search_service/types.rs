use ai_toolset::{ToolCallError, ToolResult};
use item_filters::TagFilterMode;
use models_properties::DataType;
use models_properties::service::property_value::PropertyValue;
use models_properties::service::tag_sets::{AppliedTag, CallerTagSets, TagFilter, TagMatch};
use models_search::MatchType;
use models_search::unified::UnifiedSearchResponseItem;
use models_soup::SoupProperty;
use properties::PropertiesService as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::context::SearchToolContext;

pub const PAGE_SIZE: i64 = 50;

/// How search tools match query terms. Restricted to partial/exact — the
/// backend also supports regexp and an internal query mode, but those are not
/// offered to the model.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchMatchType {
    /// Prefix matching: a single-word term matches tokens that start with it.
    #[default]
    Partial,
    /// Whole-token / exact-phrase matching, no prefix expansion.
    Exact,
}

impl From<SearchMatchType> for MatchType {
    fn from(value: SearchMatchType) -> Self {
        match value {
            SearchMatchType::Partial => MatchType::Partial,
            SearchMatchType::Exact => MatchType::Exact,
        }
    }
}

/// A search result annotated with the caller-visible tags on the item.
#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct TaggedSearchResult {
    /// The search result itself.
    #[serde(flatten)]
    pub item: UnifiedSearchResponseItem,
    /// Tags on this item visible to the user.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<AppliedTag>,
}

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct SearchToolResponse {
    pub results: Vec<TaggedSearchResult>,
}

/// Map the model-facing tag match mode onto the search request's filter mode.
pub(super) fn tag_filter_mode(mode: TagMatch) -> TagFilterMode {
    match mode {
        TagMatch::Any => TagFilterMode::Any,
        TagMatch::All => TagFilterMode::All,
    }
}

/// Resolve the model's tag filters against the caller's tag sets, returning
/// the matched option ids for `EntityFilters::tag_option_ids` plus the sets
/// for later result annotation. An unknown label fails with the available tags.
pub(super) async fn resolve_tag_filters(
    context: &SearchToolContext,
    user_id: &str,
    filters: &[TagFilter],
) -> ToolResult<(CallerTagSets, Vec<String>)> {
    let sets = fetch_caller_tag_sets(context, user_id).await?;
    let resolved = sets.resolve_filters(filters).map_err(|e| ToolCallError {
        description: e.to_string(),
        internal_error: anyhow::anyhow!(e),
    })?;
    let option_ids = resolved
        .into_iter()
        .map(|option| option.option_id.to_string())
        .collect();
    Ok((sets, option_ids))
}

/// Annotate search results with caller-visible tags. Tag properties are
/// translated into `tags` labels and removed from the raw property payload;
/// non-tag properties pass through untouched. Tag sets are only fetched when
/// a result actually carries a tag property and none were supplied.
pub(super) async fn annotate_result_tags(
    context: &SearchToolContext,
    user_id: &str,
    results: Vec<UnifiedSearchResponseItem>,
    tag_sets: Option<CallerTagSets>,
) -> ToolResult<Vec<TaggedSearchResult>> {
    let any_tags = results.iter().any(|item| {
        item_properties(item).is_some_and(|props| {
            props
                .iter()
                .any(|p| p.definition.data_type == DataType::Tag)
        })
    });

    let tag_map = if any_tags {
        let sets = match tag_sets {
            Some(sets) => sets,
            None => fetch_caller_tag_sets(context, user_id).await?,
        };
        sets.applied_tag_by_option_id()
    } else {
        Default::default()
    };

    Ok(results
        .into_iter()
        .map(|mut item| {
            let mut tags: Vec<AppliedTag> = Vec::new();
            if let Some(props) = item_properties_mut(&mut item) {
                for property in props.iter() {
                    if property.definition.data_type != DataType::Tag {
                        continue;
                    }
                    let Some(PropertyValue::SelectOption(option_ids)) = &property.value else {
                        continue;
                    };
                    for option_id in option_ids {
                        if let Some(tag) = tag_map.get(option_id)
                            && !tags.contains(tag)
                        {
                            tags.push(tag.clone());
                        }
                    }
                }
                props.retain(|p| p.definition.data_type != DataType::Tag);
            }
            TaggedSearchResult { item, tags }
        })
        .collect())
}

async fn fetch_caller_tag_sets(
    context: &SearchToolContext,
    user_id: &str,
) -> ToolResult<CallerTagSets> {
    let definitions = context
        .properties_service
        .list_caller_tag_sets(user_id)
        .await
        .map_err(|e| ToolCallError {
            description: format!("Failed to resolve the user's tags: {e}"),
            internal_error: e.into(),
        })?;
    Ok(CallerTagSets::new(definitions))
}

fn item_properties(item: &UnifiedSearchResponseItem) -> Option<&Vec<SoupProperty>> {
    match item {
        UnifiedSearchResponseItem::Document(i) => i.properties.as_ref(),
        UnifiedSearchResponseItem::Chat(i) => i.properties.as_ref(),
        UnifiedSearchResponseItem::Email(i) => i.properties.as_ref(),
        UnifiedSearchResponseItem::Project(i) => i.properties.as_ref(),
        UnifiedSearchResponseItem::Channel(_)
        | UnifiedSearchResponseItem::Call(_)
        | UnifiedSearchResponseItem::Company(_) => None,
    }
}

fn item_properties_mut(item: &mut UnifiedSearchResponseItem) -> Option<&mut Vec<SoupProperty>> {
    match item {
        UnifiedSearchResponseItem::Document(i) => i.properties.as_mut(),
        UnifiedSearchResponseItem::Chat(i) => i.properties.as_mut(),
        UnifiedSearchResponseItem::Email(i) => i.properties.as_mut(),
        UnifiedSearchResponseItem::Project(i) => i.properties.as_mut(),
        UnifiedSearchResponseItem::Channel(_)
        | UnifiedSearchResponseItem::Call(_)
        | UnifiedSearchResponseItem::Company(_) => None,
    }
}
