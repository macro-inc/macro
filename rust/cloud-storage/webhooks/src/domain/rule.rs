//! The typed webhook rule definition and its filter tree.
//!
//! A rule is stored as JSONB but always validated into these Rust types before
//! it is written. The serialized shape matches the public API contract from
//! `webhooks_plan.md`:
//!
//! ```json
//! {
//!   "version": 1,
//!   "events": ["channel.message.created"],
//!   "filters": {
//!     "all": [
//!       { "field": "data.channel_id", "op": "in", "value": ["ch_123", "ch_456"] }
//!     ]
//!   }
//! }
//! ```

use std::collections::BTreeSet;

use entity_access::domain::models::EntityType;
use serde::{Deserialize, Serialize};

use crate::domain::events;

/// The only rule schema version supported in V1.
pub const CURRENT_RULE_VERSION: u16 = 1;

/// Guards against pathological rules: maximum nesting depth of filter groups.
const MAX_FILTER_DEPTH: usize = 5;
/// Guards against pathological rules: maximum number of leaf conditions.
const MAX_CONDITIONS: usize = 100;

/// A subscribed event name. Serialized transparently as a plain string so the
/// stored `rule -> 'events'` array is a JSON array of strings (which the GIN
/// containment lookup relies on). Validation against the catalog happens via
/// [`RuleDefinition::validate_structure`], not on deserialize, so historical
/// rules referencing now-removed events still load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EventName(String);

impl EventName {
    /// The event name as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for EventName {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for EventName {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

/// A comparison operator for a single filter condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOperator {
    /// Field equals the value.
    Eq,
    /// Field does not equal the value.
    Neq,
    /// Field is one of the values in the list.
    In,
    /// Field is not any of the values in the list.
    NotIn,
    /// Field is present.
    Exists,
    /// Field is absent.
    NotExists,
    /// Field (a string) starts with the value.
    Prefix,
}

impl FilterOperator {
    /// Whether this operator expresses positive membership of a resource — and
    /// therefore requires the requesting user to have access to the referenced
    /// resource ids. Exclusion (`neq`, `not_in`) and existence checks do not
    /// subscribe the webhook to a resource, so they are not access-gated.
    fn is_positive_membership(self) -> bool {
        matches!(self, FilterOperator::Eq | FilterOperator::In)
    }
}

/// A single filter condition on an event field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Condition {
    /// The dotted field path being filtered (must be in the event's allow-list).
    pub field: String,
    /// The comparison operator.
    pub op: FilterOperator,
    /// The comparison value. Required for everything except `exists`/`not_exists`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
}

/// A node in a filter group: either a leaf condition or a nested group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterNode {
    /// A leaf condition.
    Condition(Condition),
    /// A nested group.
    Group(FilterGroup),
}

/// A boolean combination of filter nodes.
///
/// Serializes to `{"all": [...]}` / `{"any": [...]}` to match the API contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterGroup {
    /// All child nodes must match (logical AND).
    All(Vec<FilterNode>),
    /// At least one child node must match (logical OR).
    Any(Vec<FilterNode>),
}

impl FilterGroup {
    fn children(&self) -> &[FilterNode] {
        match self {
            FilterGroup::All(nodes) | FilterGroup::Any(nodes) => nodes,
        }
    }
}

/// A fully typed, ready-to-store webhook rule definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleDefinition {
    /// Rule schema version (must be [`CURRENT_RULE_VERSION`]).
    pub version: u16,
    /// The events this rule subscribes to (at least one).
    pub events: Vec<EventName>,
    /// Optional filter tree restricting which matching events fire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<FilterGroup>,
}

/// A resource referenced by a rule that the requesting user must be able to access.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceRef {
    /// The kind of resource.
    pub entity_type: EntityType,
    /// The resource's id.
    pub id: String,
    /// The filter field that referenced it (for error messages).
    pub field: String,
}

/// Errors produced while validating a rule's structure (everything that can be
/// checked without I/O — the access check happens in the service layer).
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RuleValidationError {
    /// The rule's `version` is not supported.
    #[error("unsupported rule version {0}; expected {CURRENT_RULE_VERSION}")]
    UnsupportedVersion(u16),
    /// A rule must subscribe to at least one event.
    #[error("a rule must subscribe to at least one event")]
    NoEvents,
    /// A subscribed event is not in the supported catalog.
    #[error("unknown event '{0}'")]
    UnknownEvent(String),
    /// A filter references a field not allowed for the subscribed event(s).
    #[error("filter field '{field}' is not allowed for the subscribed event(s)")]
    FieldNotAllowed {
        /// The offending field.
        field: String,
    },
    /// A filter's value is the wrong shape for its operator.
    #[error("invalid filter on field '{field}': {reason}")]
    InvalidFilter {
        /// The offending field.
        field: String,
        /// Why the filter is invalid.
        reason: String,
    },
    /// The filter tree nests more deeply than allowed.
    #[error("filter nesting is too deep (max {MAX_FILTER_DEPTH})")]
    TooDeep,
    /// The filter tree has too many conditions.
    #[error("too many filter conditions (max {MAX_CONDITIONS})")]
    TooManyConditions,
}

impl RuleDefinition {
    /// Build a rule definition from raw request parts (version defaulting to the
    /// current version). Performs no validation; call
    /// [`Self::validate_structure`] afterwards.
    pub fn from_parts(
        version: Option<u16>,
        events: Vec<String>,
        filters: Option<FilterGroup>,
    ) -> Self {
        Self {
            version: version.unwrap_or(CURRENT_RULE_VERSION),
            events: events.into_iter().map(EventName::from).collect(),
            filters,
        }
    }

    /// Validate everything about the rule that can be checked without I/O:
    /// version, that at least one known event is subscribed, that every filter
    /// field is allow-listed for all subscribed events, that operator/value
    /// shapes are consistent, and that the tree is within size limits.
    pub fn validate_structure(&self) -> Result<(), RuleValidationError> {
        if self.version != CURRENT_RULE_VERSION {
            return Err(RuleValidationError::UnsupportedVersion(self.version));
        }
        if self.events.is_empty() {
            return Err(RuleValidationError::NoEvents);
        }

        // Every subscribed event must be known, and we compute the set of fields
        // allowed by *all* of them (a filter field must be valid for every event
        // the rule fires on).
        let mut allowed_fields: Option<BTreeSet<&str>> = None;
        for event in &self.events {
            let schema = events::lookup(event.as_str())
                .ok_or_else(|| RuleValidationError::UnknownEvent(event.0.clone()))?;
            let this: BTreeSet<&str> = schema.allowed_filter_fields.iter().copied().collect();
            allowed_fields = Some(match allowed_fields {
                None => this,
                Some(acc) => acc.intersection(&this).copied().collect(),
            });
        }
        let allowed_fields = allowed_fields.unwrap_or_default();

        if let Some(filters) = &self.filters {
            let mut condition_count = 0usize;
            validate_group(filters, &allowed_fields, 1, &mut condition_count)?;
        }
        Ok(())
    }

    /// Collect every resource the rule positively subscribes to (via `eq`/`in`
    /// on a resource-typed field), so the service can verify the user's access
    /// to each. Assumes [`Self::validate_structure`] has already passed.
    ///
    /// Resource type is resolved from any subscribed event that declares the
    /// field as a resource field (the field is guaranteed allow-listed for all
    /// subscribed events by structural validation).
    pub fn resource_refs(&self) -> Vec<ResourceRef> {
        let Some(filters) = &self.filters else {
            return Vec::new();
        };
        let mut refs: Vec<ResourceRef> = Vec::new();
        collect_resource_refs(filters, &self.events, &mut refs);
        // De-duplicate (entity_type, id) so the same channel referenced twice is
        // only access-checked once.
        let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
        refs.retain(|r| seen.insert((format!("{:?}", r.entity_type), r.id.clone())));
        refs
    }

    /// The resource entity type for `field`, from any subscribed event that
    /// treats it as a resource field.
    fn resource_entity_for(events: &[EventName], field: &str) -> Option<EntityType> {
        events
            .iter()
            .filter_map(|e| events::lookup(e.as_str()))
            .find_map(|schema| schema.resource_entity_for(field))
    }
}

/// Recursively validate a filter group's structure.
fn validate_group(
    group: &FilterGroup,
    allowed_fields: &BTreeSet<&str>,
    depth: usize,
    condition_count: &mut usize,
) -> Result<(), RuleValidationError> {
    if depth > MAX_FILTER_DEPTH {
        return Err(RuleValidationError::TooDeep);
    }
    for node in group.children() {
        match node {
            FilterNode::Group(inner) => {
                validate_group(inner, allowed_fields, depth + 1, condition_count)?;
            }
            FilterNode::Condition(condition) => {
                *condition_count += 1;
                if *condition_count > MAX_CONDITIONS {
                    return Err(RuleValidationError::TooManyConditions);
                }
                validate_condition(condition, allowed_fields)?;
            }
        }
    }
    Ok(())
}

/// Validate a single condition's field and operator/value shape.
fn validate_condition(
    condition: &Condition,
    allowed_fields: &BTreeSet<&str>,
) -> Result<(), RuleValidationError> {
    if !allowed_fields.contains(condition.field.as_str()) {
        return Err(RuleValidationError::FieldNotAllowed {
            field: condition.field.clone(),
        });
    }

    let invalid = |reason: &str| RuleValidationError::InvalidFilter {
        field: condition.field.clone(),
        reason: reason.to_string(),
    };

    match condition.op {
        FilterOperator::Exists | FilterOperator::NotExists => {
            // Value is ignored; allow it to be absent or null only.
            if condition.value.as_ref().is_some_and(|v| !v.is_null()) {
                return Err(invalid("exists/not_exists must not carry a value"));
            }
        }
        FilterOperator::Eq | FilterOperator::Neq => {
            let value = condition
                .value
                .as_ref()
                .ok_or_else(|| invalid("missing value"))?;
            if !is_scalar(value) {
                return Err(invalid("value must be a string, number, or boolean"));
            }
        }
        FilterOperator::Prefix => {
            let value = condition
                .value
                .as_ref()
                .ok_or_else(|| invalid("missing value"))?;
            if !value.is_string() {
                return Err(invalid("prefix value must be a string"));
            }
        }
        FilterOperator::In | FilterOperator::NotIn => {
            let value = condition
                .value
                .as_ref()
                .ok_or_else(|| invalid("missing value"))?;
            let array = value
                .as_array()
                .ok_or_else(|| invalid("in/not_in value must be an array"))?;
            if array.is_empty() {
                return Err(invalid("in/not_in value must not be empty"));
            }
            if !array.iter().all(is_scalar) {
                return Err(invalid("in/not_in values must all be scalars"));
            }
        }
    }
    Ok(())
}

/// Recursively collect positive resource references from a filter group.
fn collect_resource_refs(group: &FilterGroup, events: &[EventName], out: &mut Vec<ResourceRef>) {
    for node in group.children() {
        match node {
            FilterNode::Group(inner) => collect_resource_refs(inner, events, out),
            FilterNode::Condition(condition) => {
                if !condition.op.is_positive_membership() {
                    continue;
                }
                let Some(entity_type) =
                    RuleDefinition::resource_entity_for(events, &condition.field)
                else {
                    continue;
                };
                match condition.op {
                    FilterOperator::Eq => {
                        if let Some(id) = condition.value.as_ref().and_then(|v| v.as_str()) {
                            out.push(ResourceRef {
                                entity_type,
                                id: id.to_string(),
                                field: condition.field.clone(),
                            });
                        }
                    }
                    FilterOperator::In => {
                        if let Some(array) = condition.value.as_ref().and_then(|v| v.as_array()) {
                            for id in array.iter().filter_map(|v| v.as_str()) {
                                out.push(ResourceRef {
                                    entity_type,
                                    id: id.to_string(),
                                    field: condition.field.clone(),
                                });
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

/// Whether a JSON value is a scalar (string, number, or boolean).
fn is_scalar(value: &serde_json::Value) -> bool {
    matches!(
        value,
        serde_json::Value::String(_) | serde_json::Value::Number(_) | serde_json::Value::Bool(_)
    )
}

#[cfg(test)]
mod test;
