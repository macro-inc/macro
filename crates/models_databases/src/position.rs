//! The fractional keys everything is ordered by; they sort as plain bytes
//! (`COLLATE "C"`), and the browser mints them through the engine's wasm build.

#[cfg(test)]
mod test;

use std::str::FromStr;

use fractional_index::FractionalIndex;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Why a key could not be minted or read.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PositionError {
    /// A string is not a key this module minted.
    #[error("`{0}` is not a position key")]
    NotAKey(String),
    /// The lower bound does not sort before the upper one.
    #[error("`{before}` does not sort before `{after}`")]
    OutOfOrder {
        /// The lower bound.
        before: String,
        /// The upper bound.
        after: String,
    },
}

/// A fractional key: the lowercase hex form of a [`FractionalIndex`], kept as
/// that string so it orders, compares and travels exactly as it is stored.
/// Hex of fixed-width bytes sorts as the bytes do, so the derived [`Ord`] is
/// the stored `COLLATE "C"` order. Minted by [`key_between`] and
/// [`keys_between`], or read back through [`FromStr`] / [`TryFrom<String>`],
/// which accept only a key one of them could have minted.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, utoipa::ToSchema, specta::Type)]
#[specta(transparent)]
#[schema(value_type = String)]
pub struct Position(String);

// The string's own schema, inlined, as a key is a string to its readers.
#[cfg(feature = "schema")]
impl schemars::JsonSchema for Position {
    fn inline_schema() -> bool {
        <String as schemars::JsonSchema>::inline_schema()
    }

    fn schema_name() -> std::borrow::Cow<'static, str> {
        <String as schemars::JsonSchema>::schema_name()
    }

    fn schema_id() -> std::borrow::Cow<'static, str> {
        <String as schemars::JsonSchema>::schema_id()
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        <String as schemars::JsonSchema>::json_schema(generator)
    }
}

impl Position {
    /// The key as it is stored.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn index(&self) -> FractionalIndex {
        FractionalIndex::from_string(&self.0)
            .unwrap_or_else(|_| unreachable!("a position holds only minted keys"))
    }
}

impl FromStr for Position {
    type Err = PositionError;

    fn from_str(key: &str) -> Result<Self, Self::Err> {
        // `from_string` ignores an odd trailing digit and reads either case,
        // so only its own rendering of the key is the key.
        match FractionalIndex::from_string(key) {
            Ok(index) if index.to_string() == key => Ok(Self(key.to_owned())),
            _ => Err(PositionError::NotAKey(key.to_owned())),
        }
    }
}

impl TryFrom<String> for Position {
    type Error = PositionError;

    fn try_from(key: String) -> Result<Self, Self::Error> {
        key.parse()
    }
}

impl From<Position> for String {
    fn from(position: Position) -> Self {
        position.0
    }
}

impl Serialize for Position {
    fn serialize<Out: Serializer>(&self, serializer: Out) -> Result<Out::Ok, Out::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Position {
    fn deserialize<In: Deserializer<'de>>(deserializer: In) -> Result<Self, In::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

impl std::fmt::Display for Position {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// A key that sorts after `before` and before `after`; either bound may be
/// left out to place it first or last, and with neither it is the first key
/// of an empty list.
pub fn key_between(
    before: Option<&Position>,
    after: Option<&Position>,
) -> Result<Position, PositionError> {
    let lower = before.map(Position::index);
    let upper = after.map(Position::index);
    FractionalIndex::new(lower.as_ref(), upper.as_ref())
        .map(|key| Position(key.to_string()))
        .ok_or_else(|| PositionError::OutOfOrder {
            before: before.map(Position::to_string).unwrap_or_default(),
            after: after.map(Position::to_string).unwrap_or_default(),
        })
}

/// `count` keys in order between `before` and `after`, bisecting so their
/// length grows with the logarithm of `count` rather than with `count`.
pub fn keys_between(
    before: Option<&Position>,
    after: Option<&Position>,
    count: usize,
) -> Result<Vec<Position>, PositionError> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let middle = key_between(before, after)?;
    let lower_half = count / 2;
    let mut keys = keys_between(before, Some(&middle), lower_half)?;
    keys.push(middle.clone());
    keys.extend(keys_between(Some(&middle), after, count - lower_half - 1)?);
    Ok(keys)
}
