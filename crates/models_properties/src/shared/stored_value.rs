//! The JSON form both property value enums are stored and sent in.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::openapi::RefOr;
use utoipa::openapi::schema::{Object, ObjectBuilder, Schema, Type};
use uuid::Uuid;

use super::{DateRange, EntityReference};

#[cfg(test)]
mod test;

/// `{"type": ..., "value": ...}`, the tagged value every property holds.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(tag = "type", content = "value")]
pub(crate) enum TaggedValue {
    /// Boolean value
    /// Serializes as: {"type": "Boolean", "value": true}
    #[serde(rename = "Boolean")]
    Bool(bool),
    /// Numeric value
    /// Serializes as: {"type": "Number", "value": 42.5}
    #[serde(rename = "Number")]
    Num(f64),
    /// String value
    /// Serializes as: {"type": "String", "value": "text"}
    #[serde(rename = "String")]
    Str(String),
    /// Date value, with or without a time of day
    /// Serializes as: {"type": "Date", "value": "2025-01-01T00:00:00Z"}, plus "has_time": true when a time was set
    Date(DateTime<Utc>),
    /// Date range value
    /// Serializes as: {"type": "DateRange", "value": {"start": "2025-01-01T00:00:00Z", "end": "2025-01-31T00:00:00Z"}}
    DateRange(DateRange),
    /// Select option(s) - always an array (check is_multi_select to determine if single or multi)
    /// Single-select: {"type": "SelectOption", "value": ["uuid"]} (length 0 or 1)
    /// Multi-select: {"type": "SelectOption", "value": ["uuid1", "uuid2", ...]} (length 0+)
    SelectOption(Vec<Uuid>),
    /// Entity reference(s) - always an array (check is_multi_select to determine if single or multi)
    /// Single-select: {"type": "EntityReference", "value": [{...}]} (length 0 or 1)
    /// Multi-select: {"type": "EntityReference", "value": [{...}, {...}, ...]} (length 0+)
    #[serde(rename = "EntityReference")]
    EntityRef(Vec<EntityReference>),
    /// Link value(s) - always an array (check is_multi_select to determine if single or multi)
    /// Single-select: {"type": "Link", "value": ["https://example.com"]} (length 0 or 1)
    /// Multi-select: {"type": "Link", "value": ["https://example.com", "https://other.com"]} (length 0+)
    Link(Vec<String>),
}

const HAS_TIME_DESCRIPTION: &str = "True when the date is an exact instant, its time of day set. \
    False or absent, the value is a whole day, shown as the day its instant falls \
    on in the viewer's time zone.";

/// The OpenAPI schema of a value as it is sent: the tagged forms, with the
/// optional `has_time` flag beside a date's `type` and `value`. Both
/// `PropertyValue` enums document themselves with it.
pub(crate) fn property_value_schema(description: &str) -> RefOr<Schema> {
    let mut schema = <TaggedValue as utoipa::PartialSchema>::schema();
    if let RefOr::T(Schema::OneOf(one_of)) = &mut schema {
        one_of.description = Some(description.to_owned());
        for variant in &mut one_of.items {
            if let RefOr::T(Schema::Object(object)) = variant
                && is_tagged(object, "Date")
            {
                object.properties.insert(
                    "has_time".to_owned(),
                    ObjectBuilder::new()
                        .schema_type(Type::Boolean)
                        .description(Some(HAS_TIME_DESCRIPTION))
                        .into(),
                );
            }
        }
    }
    schema
}

/// The schemas `property_value_schema` refers to.
pub(crate) fn property_value_schemas(schemas: &mut Vec<(String, RefOr<Schema>)>) {
    <TaggedValue as utoipa::ToSchema>::schemas(schemas);
}

fn is_tagged(object: &Object, tag: &str) -> bool {
    matches!(
        object.properties.get("type"),
        Some(RefOr::T(Schema::Object(tag_schema)))
            if tag_schema
                .enum_values
                .as_ref()
                .is_some_and(|values| values.iter().any(|value| value == tag))
    )
}

/// A tagged value with the date flag beside its `type` and `value`, written
/// only when set so every other value keeps the form it had before the flag.
/// A flag on anything but a date is ignored.
#[derive(Serialize, Deserialize)]
pub(crate) struct StoredValue {
    #[serde(flatten)]
    pub(crate) value: TaggedValue,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) has_time: bool,
}
