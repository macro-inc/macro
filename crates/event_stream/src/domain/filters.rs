//! Subscriber filters, shared by live streams and persisted webhooks.
//!
//! A filter set is valid for both deliveries or neither. `events` entries are
//! exact names, a family wildcard (`document.*`) or `*`. Wildcards expand
//! against the catalog at match time, so a new event in a family arrives
//! without re-registering; they work only for users with the
//! `public-event-stream` flag, and are literal names (which match nothing)
//! otherwise. Webhooks keep their original cap of 50 filters; streams take
//! 32.

#[cfg(test)]
mod test;

use crate::domain::catalog;
use serde::{Deserialize, Serialize};

/// Most filters one live stream may hold (shared with routine triggers).
pub const MAX_STREAM_FILTERS: usize = 32;
/// Most filters one persisted webhook may hold: the cap webhooks were
/// created under before streams shared their filters, kept because the
/// webhook API is a deployed boundary.
pub const MAX_WEBHOOK_FILTERS: usize = 50;
/// Most event names one filter may hold.
pub const MAX_FILTER_EVENTS: usize = 100;
/// Most entity ids one filter may hold (shared with routine triggers).
pub const MAX_FILTER_IDS: usize = 100;
/// Most entity types one filter may hold.
pub const MAX_FILTER_ENTITY_TYPES: usize = 32;
/// Longest event name, entity id or entity type.
pub const MAX_FILTER_VALUE_LEN: usize = 256;

/// The wildcard matching every catalog event.
pub const ALL_EVENTS: &str = "*";

/// Event and optional entity constraints that select deliveries. Every
/// present constraint must accept an event for the filter to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct WebhookFilter {
    /// Event names matched by this filter: exact names, a family wildcard
    /// such as `document.*`, or `*` for every event. Wildcards require the
    /// `public-event-stream` feature.
    pub events: Vec<String>,
    /// Entity ids matched by this filter. When absent, the filter matches all
    /// entity ids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    /// Entity types matched by this filter, such as `document` or `channel`.
    /// When absent, the filter matches every entity type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_types: Option<Vec<String>>,
}

/// Collection of filters used to decide delivery eligibility.
pub type WebhookFilters = Vec<WebhookFilter>;

/// The fields of an event a filter reads.
#[derive(Debug, Clone, Copy)]
pub struct FilterSubject<'a> {
    /// Public event name.
    pub event_name: &'a str,
    /// Public entity type.
    pub entity_type: &'a str,
    /// Entity id.
    pub entity_id: &'a str,
}

/// The family of an event name: what precedes its first `.`.
pub fn family(event_name: &str) -> Option<&str> {
    event_name.split_once('.').map(|(family, _)| family)
}

/// The family a `family.*` wildcard names.
pub fn wildcard_family(pattern: &str) -> Option<&str> {
    pattern
        .strip_suffix(".*")
        .filter(|family| !family.is_empty() && !family.contains(['.', '*']))
}

/// Whether `pattern` accepts `event_name`. With `wildcards` off every
/// pattern is a literal name, as before wildcards existed.
pub fn event_pattern_accepts(pattern: &str, event_name: &str, wildcards: bool) -> bool {
    if pattern == event_name {
        return true;
    }
    if !wildcards || !catalog::is_public_event(event_name) {
        return false;
    }
    if pattern == ALL_EVENTS {
        return true;
    }
    wildcard_family(pattern).is_some_and(|wanted| family(event_name) == Some(wanted))
}

impl WebhookFilter {
    /// Whether this filter accepts an event.
    pub fn accepts(&self, subject: FilterSubject<'_>, wildcards: bool) -> bool {
        let event_matches = self
            .events
            .iter()
            .any(|pattern| event_pattern_accepts(pattern, subject.event_name, wildcards));
        let id_matches = self
            .ids
            .as_ref()
            .is_none_or(|ids| ids.iter().any(|id| id == subject.entity_id));
        let type_matches = self
            .entity_types
            .as_ref()
            .is_none_or(|types| types.iter().any(|kind| kind == subject.entity_type));

        event_matches && id_matches && type_matches
    }

    /// Whether this filter uses a wildcard.
    pub fn uses_wildcards(&self) -> bool {
        self.events.iter().any(|pattern| pattern.contains('*'))
    }
}

/// Whether any filter accepts the event.
pub fn any_accepts(filters: &[WebhookFilter], subject: FilterSubject<'_>, wildcards: bool) -> bool {
    filters
        .iter()
        .any(|filter| filter.accepts(subject, wildcards))
}

/// A filter set that cannot be accepted.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct InvalidFilters(pub String);

fn valid_value(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value.len() <= MAX_FILTER_VALUE_LEN
}

fn validate_list(
    field: &str,
    values: &[String],
    max: usize,
    required: bool,
) -> Result<(), InvalidFilters> {
    if values.is_empty() {
        let message = if required {
            format!("filters[].{field} must be a non-empty array of strings")
        } else {
            format!("filters[].{field} must be a non-empty array of strings when present")
        };
        return Err(InvalidFilters(message));
    }
    if values.len() > max {
        return Err(InvalidFilters(format!(
            "filters[].{field} must include at most {max} entries"
        )));
    }
    if !values.iter().all(|value| valid_value(value)) {
        return Err(InvalidFilters(format!(
            "filters[].{field} entries must be non-empty strings at most {MAX_FILTER_VALUE_LEN} characters"
        )));
    }
    Ok(())
}

fn validate_event_pattern(pattern: &str) -> Result<(), InvalidFilters> {
    if !pattern.contains('*') || pattern == ALL_EVENTS || wildcard_family(pattern).is_some() {
        return Ok(());
    }
    Err(InvalidFilters(format!(
        "filters[].events entry `{pattern}` is not an event name, a family wildcard such as `document.*`, or `*`"
    )))
}

/// Reject a filter set with more than `max_filters` filters, or any filter
/// neither delivery accepts. Streams pass [`MAX_STREAM_FILTERS`], webhooks
/// [`MAX_WEBHOOK_FILTERS`]; every other rule is shared.
pub fn validate_filters(
    filters: &[WebhookFilter],
    max_filters: usize,
) -> Result<(), InvalidFilters> {
    if filters.is_empty() {
        return Err(InvalidFilters(
            "filters must be a non-empty array".to_string(),
        ));
    }
    if filters.len() > max_filters {
        return Err(InvalidFilters(format!(
            "filters must include at most {max_filters} entries"
        )));
    }

    for filter in filters {
        validate_list("events", &filter.events, MAX_FILTER_EVENTS, true)?;
        for pattern in &filter.events {
            validate_event_pattern(pattern)?;
        }
        if let Some(ids) = &filter.ids {
            validate_list("ids", ids, MAX_FILTER_IDS, false)?;
        }
        if let Some(entity_types) = &filter.entity_types {
            validate_list("entity_types", entity_types, MAX_FILTER_ENTITY_TYPES, false)?;
        }
    }

    Ok(())
}
