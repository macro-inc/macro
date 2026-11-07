//! Validated, verbatim document id values.
#![deny(missing_docs)]

/// A document UUID or legacy id, stored and compared verbatim.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "String", into = "String")]
pub struct DocumentId(String);

/// A document id cannot be empty, padded with whitespace, or contain controls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DocumentIdError {
    /// The supplied text violates the document-id predicate.
    #[error("invalid document id")]
    PredicateViolated,
}

impl std::str::FromStr for DocumentId {
    type Err = DocumentIdError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::try_new(value)
    }
}
impl TryFrom<&str> for DocumentId {
    type Error = DocumentIdError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_new(value)
    }
}
impl std::borrow::Borrow<String> for DocumentId {
    fn borrow(&self) -> &String {
        &self.0
    }
}
impl TryFrom<String> for DocumentId {
    type Error = DocumentIdError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(value)
    }
}
impl From<DocumentId> for String {
    fn from(value: DocumentId) -> Self {
        value.0
    }
}
impl AsRef<str> for DocumentId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}
impl std::fmt::Display for DocumentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl DocumentId {
    /// Validate a document id without modifying its text.
    pub fn try_new(value: impl Into<String>) -> Result<Self, DocumentIdError> {
        let value = value.into();
        if value.is_empty() || value.trim() != value || value.chars().any(char::is_control) {
            return Err(DocumentIdError::PredicateViolated);
        }
        Ok(Self(value))
    }

    /// Consume this id and return the original text.
    pub fn into_inner(self) -> String {
        self.0
    }

    /// Borrow the stored identifier without normalization.
    pub fn as_str(&self) -> &str {
        self.as_ref()
    }

    /// Parse UUID-shaped ids; legacy identifiers return `None`.
    pub fn as_uuid(&self) -> Option<uuid_value::Uuid> {
        uuid_value::Uuid::try_parse(self.as_str()).ok()
    }

    /// Whether this identifier predates UUID-shaped document ids.
    pub fn is_legacy(&self) -> bool {
        self.as_uuid().is_none()
    }

    /// Construct the lowercase hyphenated representation of a supplied UUID.
    pub fn from_uuid(id: uuid_value::Uuid) -> Self {
        Self(id.hyphenated().to_string())
    }
}

impl std::borrow::Borrow<str> for DocumentId {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

#[cfg(feature = "schema")]
impl utoipa::ToSchema for DocumentId {}

#[cfg(feature = "schema")]
impl utoipa::PartialSchema for DocumentId {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        <String as utoipa::PartialSchema>::schema()
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for DocumentId {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::Type<sqlx::Postgres>>::type_info()
    }
    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <String as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::postgres::PgHasArrayType for DocumentId {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::postgres::PgHasArrayType>::array_type_info()
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for DocumentId {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        <String as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&self.as_str().to_owned(), buf)
    }
}

#[cfg(feature = "sqlx")]
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for DocumentId {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <String as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(Self::try_new(value)?)
    }
}

#[cfg(test)]
mod test;
