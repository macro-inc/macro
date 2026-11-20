//! The JSON form both property value enums are stored and sent in.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DateRange, EntityReference};

/// `{"type": ..., "value": ...}`, the tagged value every property holds.
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub(crate) enum TaggedValue {
    #[serde(rename = "Boolean")]
    Bool(bool),
    #[serde(rename = "Number")]
    Num(f64),
    #[serde(rename = "String")]
    Str(String),
    Date(DateTime<Utc>),
    DateRange(DateRange),
    SelectOption(Vec<Uuid>),
    #[serde(rename = "EntityReference")]
    EntityRef(Vec<EntityReference>),
    Link(Vec<String>),
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
