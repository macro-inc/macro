//! Caller-visible tag sets and label resolution for AI tool surfaces.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::shared::PropertyOwner;

use super::property_definition_with_options::PropertyDefinitionWithOptions;
use super::property_option::PropertyOptionValue;

/// Which tag set a tag belongs to, relative to the caller.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema, utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum TagScope {
    /// The caller's personal tag set.
    Personal,
    /// A team tag set the caller belongs to.
    Team,
}

/// A tag applied to an item, resolved to its human-readable label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppliedTag {
    /// The tag's label.
    pub label: String,
    /// Whether the tag comes from the caller's personal set or a team set.
    pub scope: TagScope,
}

/// A tag selector in a tool request, matched by label against the caller's tag sets.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TagFilter {
    /// The tag label to match, case-insensitive.
    #[schemars(description = "The tag label to match, case-insensitive.")]
    pub label: String,
    /// Restrict the match to one scope. When omitted, both the personal and
    /// team sets are matched.
    #[schemars(
        description = "Restrict the label match to \"personal\" or \"team\". Omit to match both scopes."
    )]
    #[serde(default)]
    pub scope: Option<TagScope>,
}

/// How multiple tag filters combine when filtering items.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TagMatch {
    /// Items carrying at least one of the tags match.
    #[default]
    Any,
    /// Only items carrying every one of the tags match.
    All,
}

/// A tag filter label that matched nothing in the caller's tag sets.
#[derive(Debug, Clone, thiserror::Error)]
#[error("unknown tag \"{label}\"{}", format_available(available))]
pub struct UnknownTagError {
    /// The label that failed to resolve.
    pub label: String,
    /// Every label the caller can actually filter by.
    pub available: Vec<String>,
}

fn format_available(available: &[String]) -> String {
    if available.is_empty() {
        ". The user has no tags yet.".to_string()
    } else {
        format!(". Available tags: {}.", available.join(", "))
    }
}

/// One resolved tag option from the caller's sets.
#[derive(Debug, Clone)]
pub struct CallerTagOption {
    /// The owning tag property definition.
    pub definition_id: Uuid,
    /// The option id, used in property/tag filters and when applying the tag.
    pub option_id: Uuid,
    /// The tag's label.
    pub label: String,
    /// The tag's color, when set.
    pub color: Option<String>,
    /// Whether the tag is personal or team-scoped.
    pub scope: TagScope,
}

/// The tag sets visible to a caller (their personal set plus their teams' sets),
/// flattened for label/option resolution.
#[derive(Debug, Clone, Default)]
pub struct CallerTagSets {
    options: Vec<CallerTagOption>,
}

impl CallerTagSets {
    /// Flatten tag definitions into resolvable options. Definitions without a
    /// user or team owner are skipped.
    pub fn new(definitions: Vec<PropertyDefinitionWithOptions>) -> Self {
        let mut options = Vec::new();
        for def in definitions {
            let scope = match def.definition.owner {
                PropertyOwner::User { .. } => TagScope::Personal,
                PropertyOwner::Team { .. } => TagScope::Team,
                PropertyOwner::System => continue,
            };
            for option in def.property_options {
                let label = match option.value {
                    PropertyOptionValue::String(s) => s,
                    PropertyOptionValue::Number(n) => n.to_string(),
                };
                options.push(CallerTagOption {
                    definition_id: def.definition.id,
                    option_id: option.id,
                    label,
                    color: option.color,
                    scope,
                });
            }
        }
        Self { options }
    }

    /// Every resolvable tag option.
    pub fn options(&self) -> &[CallerTagOption] {
        &self.options
    }

    /// True when the caller has no tags in any set.
    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }

    /// Map from option id to its resolved applied-tag form.
    pub fn applied_tag_by_option_id(&self) -> HashMap<Uuid, AppliedTag> {
        self.options
            .iter()
            .map(|o| {
                (
                    o.option_id,
                    AppliedTag {
                        label: o.label.clone(),
                        scope: o.scope,
                    },
                )
            })
            .collect()
    }

    /// Every label the caller can filter by, deduplicated case-insensitively
    /// and sorted.
    pub fn available_labels(&self) -> Vec<String> {
        let mut labels: Vec<String> = self.options.iter().map(|o| o.label.clone()).collect();
        labels.sort_by_key(|l| l.to_lowercase());
        labels.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        labels
    }

    /// Resolve tag filters to concrete options. Each filter matches
    /// case-insensitively within its scope (both scopes when unset); a filter
    /// matching nothing fails with the caller's available labels. Matches
    /// across all filters are unioned (OR semantics).
    pub fn resolve_filters(
        &self,
        filters: &[TagFilter],
    ) -> Result<Vec<CallerTagOption>, UnknownTagError> {
        let mut resolved: Vec<CallerTagOption> = Vec::new();
        for filter in filters {
            let matches: Vec<&CallerTagOption> = self
                .options
                .iter()
                .filter(|o| {
                    o.label.eq_ignore_ascii_case(filter.label.trim())
                        && filter.scope.is_none_or(|scope| o.scope == scope)
                })
                .collect();
            if matches.is_empty() {
                return Err(UnknownTagError {
                    label: filter.label.clone(),
                    available: self.available_labels(),
                });
            }
            for option in matches {
                if !resolved.iter().any(|r| r.option_id == option.option_id) {
                    resolved.push(option.clone());
                }
            }
        }
        Ok(resolved)
    }
}
