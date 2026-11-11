//! Sort descriptors and position values for Soup's dynamic query.

use chrono::{DateTime, Utc};
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod, Sortable};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use uuid::Uuid;

use super::SoupSortDirection;

/// Marks a name sort inside the untagged cursor encodings below.
///
/// [`DynamicSort`] and [`DynamicSortValue`] are untagged, and a name sort's
/// payload is otherwise a subset of a property sort's. This tag, serialized as
/// the string `"name"` like [`models_pagination::NotifiedAt`], is what tells
/// the two apart when a cursor comes back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "String", try_from = "String")]
pub struct NameSortTag;

const NAME_SORT_TAG: &str = "name";

impl From<NameSortTag> for String {
    fn from(_: NameSortTag) -> Self {
        NAME_SORT_TAG.to_string()
    }
}

impl TryFrom<String> for NameSortTag {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value == NAME_SORT_TAG {
            Ok(NameSortTag)
        } else {
            Err(format!("expected {NAME_SORT_TAG:?}, got {value:?}"))
        }
    }
}

/// The existing timestamp sort, the item's own name, or a selected property.
///
/// Variant order matters: untagged deserialization takes the first variant
/// that matches, and a property payload would also satisfy [`Self::Name`] if
/// that variant were tried without its tag field present.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DynamicSort {
    /// Preserve the deployed timestamp sort encoding.
    Timestamp(SimpleSortMethod),
    /// Sort by the item's own name, case-insensitively, with unnamed last.
    Name {
        /// Discriminates this variant from [`Self::Property`].
        name: NameSortTag,
        /// Ascending or descending names, with unnamed items last.
        direction: SoupSortDirection,
    },
    /// Sort by a definition visible to the requesting viewer.
    Property {
        /// Selected property definition, not an assignment ID.
        property_definition_id: Uuid,
        /// Ascending or descending property values, with missing values last.
        direction: SoupSortDirection,
    },
}

impl From<SimpleSortMethod> for DynamicSort {
    fn from(value: SimpleSortMethod) -> Self {
        Self::Timestamp(value)
    }
}

impl DynamicSort {
    /// A name sort and its direction, when this is one.
    pub fn name_direction(self) -> Option<SoupSortDirection> {
        match self {
            Self::Name { direction, .. } => Some(direction),
            Self::Timestamp(_) | Self::Property { .. } => None,
        }
    }

    /// Construct a name sort in the given direction.
    pub fn name(direction: SoupSortDirection) -> Self {
        Self::Name {
            name: NameSortTag,
            direction,
        }
    }

    /// Timestamp column used by the existing top clauses and by sort ties.
    pub fn timestamp_method(self) -> SimpleSortMethod {
        match self {
            Self::Timestamp(method) => method,
            Self::Name { .. } | Self::Property { .. } => SimpleSortMethod::UpdatedAt,
        }
    }

    /// Convert an existing timestamp request without changing its wire cursor.
    pub fn from_timestamp_query<F>(
        query: Query<Uuid, SimpleSortMethod, F>,
    ) -> Query<Uuid, Self, F> {
        match query {
            Query::Sort(sort, filter) => Query::Sort(sort.into(), filter),
            Query::Cursor(cursor) => Query::Cursor(Cursor {
                id: cursor.id,
                limit: cursor.limit,
                val: CursorVal {
                    sort_type: cursor.val.sort_type.into(),
                    last_val: DynamicSortValue::Timestamp(cursor.val.last_val),
                },
                filter: cursor.filter,
            }),
        }
    }

    /// Construct the position returned by the dynamic SQL row.
    ///
    /// `name` is the item's own name as the query read it; SQL lower-cases it
    /// again on the next page, so the cursor keeps the stored spelling.
    pub fn position(
        self,
        key: Option<f64>,
        name: Option<&str>,
        timestamp: DateTime<Utc>,
    ) -> DynamicSortValue {
        match self {
            Self::Timestamp(_) => DynamicSortValue::Timestamp(timestamp),
            Self::Name { direction, .. } => DynamicSortValue::Name {
                name: NameSortTag,
                key: name.map(ToOwned::to_owned),
                timestamp,
                direction,
            },
            Self::Property { direction, .. } => DynamicSortValue::Property {
                key: key.map(PropertySortKey::Number),
                timestamp,
                direction,
            },
        }
    }
}

impl Sortable for DynamicSort {
    type Value = DynamicSortValue;
}

/// The key type of a property sort cursor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PropertySortKey {
    /// A numeric key, including dates as epoch microseconds and option ranks.
    Number(f64),
}

/// A timestamp cursor retains its old string encoding; property cursors add a
/// key, and name cursors carry the last name alongside the [`NameSortTag`]
/// that keeps them distinguishable from property cursors.
///
/// Variant order matters for the same reason it does on [`DynamicSort`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DynamicSortValue {
    /// Position in an ordinary timestamp query.
    Timestamp(DateTime<Utc>),
    /// Last name read, and its update-time tie breaker.
    Name {
        /// Discriminates this variant from [`Self::Property`].
        name: NameSortTag,
        /// A missing name sorts after every present name.
        key: Option<String>,
        /// Update timestamp for deterministic ties.
        timestamp: DateTime<Utc>,
        /// Name sort direction.
        direction: SoupSortDirection,
    },
    /// Typed property key and its update-time tie breaker.
    Property {
        /// A missing key sorts after every present key.
        key: Option<PropertySortKey>,
        /// Update timestamp for deterministic ties.
        timestamp: DateTime<Utc>,
        /// Property sort direction.
        direction: SoupSortDirection,
    },
}

impl DynamicSortValue {
    /// Timestamp for the SQL keyset.
    pub fn timestamp(&self) -> DateTime<Utc> {
        match self {
            Self::Timestamp(value) => *value,
            Self::Name { timestamp, .. } | Self::Property { timestamp, .. } => *timestamp,
        }
    }

    /// Numeric key for the SQL keyset; ordinary timestamp queries use zero.
    pub fn key(&self) -> Option<f64> {
        match self {
            Self::Timestamp(_) => Some(0.0),
            Self::Name { .. } => None,
            Self::Property { key, .. } => key.as_ref().map(|key| match key {
                PropertySortKey::Number(number) => *number,
            }),
        }
    }

    /// Name for the SQL keyset of a name sort.
    pub fn name(&self) -> Option<&str> {
        match self {
            Self::Timestamp(_) | Self::Property { .. } => None,
            Self::Name { key, .. } => key.as_deref(),
        }
    }
}

impl PartialEq for DynamicSortValue {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for DynamicSortValue {}
impl PartialOrd for DynamicSortValue {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for DynamicSortValue {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (
                Self::Property {
                    key: left,
                    direction,
                    ..
                },
                Self::Property {
                    key: right,
                    direction: other_direction,
                    ..
                },
            ) => {
                if direction != other_direction {
                    return (*direction == SoupSortDirection::Desc)
                        .cmp(&(*other_direction == SoupSortDirection::Desc));
                }
                match (left, right) {
                    (Some(PropertySortKey::Number(left)), Some(PropertySortKey::Number(right))) => {
                        let order = left.total_cmp(right);
                        if *direction == SoupSortDirection::Asc {
                            order.reverse()
                        } else {
                            order
                        }
                    }
                    (Some(_), None) => Ordering::Greater,
                    (None, Some(_)) => Ordering::Less,
                    (None, None) => Ordering::Equal,
                }
            }
            (
                Self::Name {
                    key: left,
                    direction,
                    ..
                },
                Self::Name {
                    key: right,
                    direction: other_direction,
                    ..
                },
            ) => {
                if direction != other_direction {
                    return (*direction == SoupSortDirection::Desc)
                        .cmp(&(*other_direction == SoupSortDirection::Desc));
                }
                match (left, right) {
                    (Some(left), Some(right)) => {
                        // SQL orders on `lower(name)`; match that here.
                        let order = left.to_lowercase().cmp(&right.to_lowercase());
                        if *direction == SoupSortDirection::Asc {
                            order.reverse()
                        } else {
                            order
                        }
                    }
                    (Some(_), None) => Ordering::Greater,
                    (None, Some(_)) => Ordering::Less,
                    (None, None) => Ordering::Equal,
                }
            }
            (Self::Timestamp(left), Self::Timestamp(right)) => left.cmp(right),
            (Self::Timestamp(_), Self::Name { .. } | Self::Property { .. }) => Ordering::Less,
            (Self::Name { .. }, Self::Timestamp(_)) => Ordering::Greater,
            (Self::Name { .. }, Self::Property { .. }) => Ordering::Less,
            (Self::Property { .. }, Self::Timestamp(_) | Self::Name { .. }) => Ordering::Greater,
        }
        .then_with(|| self.timestamp().cmp(&other.timestamp()))
    }
}
