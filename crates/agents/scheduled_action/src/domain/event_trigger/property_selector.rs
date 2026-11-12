//! Which task property changes a routine watches, without asking a model.

use macro_uuid::Uuid;
use properties_types::service::property_value::PropertyValue;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

const MAX_PROPERTY_VALUES: usize = 100;
const MAX_VALUE_CHARS: usize = 320;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("expected at most 100 property values, each 1 to 320 characters")]
pub struct PropertyValuesError;

/// Narrows a task property change filter to one property and, optionally, the
/// values it must gain.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PropertySelector {
    /// The property definition that must have changed.
    #[schema(value_type = String)]
    definition_id: Uuid,
    /// Select option ids or referenced entity ids, one of which the change must
    /// add. Any change to the property matches when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    values: Vec<String>,
}

impl PropertySelector {
    /// Sort and deduplicate so equal selectors compare equal.
    pub(super) fn canonicalized(mut self) -> Result<Self, PropertyValuesError> {
        let valid = |value: &String| !value.is_empty() && value.chars().count() <= MAX_VALUE_CHARS;
        if self.values.len() > MAX_PROPERTY_VALUES || !self.values.iter().all(valid) {
            return Err(PropertyValuesError);
        }
        self.values.sort_unstable();
        self.values.dedup();
        Ok(self)
    }

    pub fn definition_id(&self) -> Uuid {
        self.definition_id
    }

    pub fn values(&self) -> &[String] {
        &self.values
    }

    pub(super) fn accepts(&self, change: Option<&PropertyChange>) -> bool {
        change.is_some_and(|change| {
            change.definition_id == self.definition_id
                && (self.values.is_empty()
                    || self.values.iter().any(|value| change.added.contains(value)))
        })
    }
}

/// What a task property event did, kept on the run so its filters can be
/// tested again at claim. Holds only ids: free text and dates are never kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertyChange {
    definition_id: Uuid,
    /// Values the property has now and didn't before; all of them when the
    /// writer couldn't capture the previous value.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    added: Vec<String>,
}

impl PropertyChange {
    pub(super) fn updated(
        definition_id: Uuid,
        value: Option<&PropertyValue>,
        previous: Option<&PropertyValue>,
    ) -> Self {
        let previous = value_ids(previous);
        let added = value_ids(value)
            .into_iter()
            .filter(|id| !previous.contains(id))
            .collect();
        Self {
            definition_id,
            added,
        }
    }

    pub(super) fn removed(definition_id: Uuid) -> Self {
        Self {
            definition_id,
            added: Vec::new(),
        }
    }

    pub(super) fn definition_id(&self) -> Uuid {
        self.definition_id
    }
}

fn value_ids(value: Option<&PropertyValue>) -> Vec<String> {
    match value {
        Some(PropertyValue::SelectOption(ids)) => ids.iter().map(Uuid::to_string).collect(),
        Some(PropertyValue::EntityRef(references)) => references
            .iter()
            .map(|reference| reference.entity_id.clone())
            .collect(),
        _ => Vec::new(),
    }
}
