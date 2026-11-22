//! Explicit JavaScript absent/null/value fields, without untyped node payloads.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
/// A property whose absence and explicit null have different wire meaning.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Maybe<T> {
    /// JavaScript undefined: omit the property.
    #[default]
    Missing,
    /// Explicit JSON null.
    Null,
    /// A typed property value.
    Value(T),
}
impl<T> Maybe<T> {
    /// Convert an optional concrete value to a JavaScript optional property.
    pub fn from_option(value: Option<T>) -> Self {
        value.map_or(Self::Missing, Self::Value)
    }
    /// Whether serialization should omit this property.
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }
    /// Borrow a concrete value; absent and null return None.
    pub fn as_ref(&self) -> Option<&T> {
        if let Self::Value(value) = self {
            Some(value)
        } else {
            None
        }
    }
    /// Whether a concrete value satisfies a predicate.
    pub fn is_some_and(&self, predicate: impl FnOnce(&T) -> bool) -> bool {
        self.as_ref().is_some_and(predicate)
    }
}
impl<T: std::ops::Deref> Maybe<T> {
    /// Borrow a concrete dereferenced value.
    pub fn as_deref(&self) -> Option<&T::Target> {
        self.as_ref().map(std::ops::Deref::deref)
    }
}
impl<T: Serialize> Serialize for Maybe<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Missing | Self::Null => serializer.serialize_none(),
            Self::Value(value) => value.serialize(serializer),
        }
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Maybe<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Option::<T>::deserialize(deserializer)?.map_or(Self::Null, Self::Value))
    }
}
