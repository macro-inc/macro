//! Validated, verbatim lexical node id values.
#![deny(missing_docs)]

/// A non-empty identifier, stored and compared verbatim.
#[nutype::nutype(
    validate(predicate = |id: &str| !id.is_empty()),
    derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, AsRef, Display, FromStr,
           TryFrom, Into, Serialize, Deserialize, Borrow)
)]
pub struct LexicalNodeId(String);

impl LexicalNodeId {
    /// Borrow the stored identifier without normalization.
    pub fn as_str(&self) -> &str {
        self.as_ref()
    }

    /// Apply JS truthiness to a stored node id; an empty string means no id.
    pub fn from_stored(stored: &str) -> Option<Self> {
        Self::try_new(stored.to_owned()).ok()
    }

    /// Diagnose the generated nanoid shape without restricting accepted ids.
    pub fn is_generated_form(&self) -> bool {
        matches!(
            self.as_str().len(),
            WEB_ID_LENGTH | PLUGIN_DEFAULT_ID_LENGTH
        ) && self
            .as_str()
            .bytes()
            .all(|byte| NANOID_URL_ALPHABET.contains(&byte))
    }
}

/// Nanoid 5.1.16's URL-safe alphabet, in generator order.
pub const NANOID_URL_ALPHABET: &[u8; 64] =
    b"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
/// Node id length used by the web editor and update-all operation.
pub const WEB_ID_LENGTH: usize = 8;
/// Default node id length used by the plugin.
pub const PLUGIN_DEFAULT_ID_LENGTH: usize = 11;

#[cfg(feature = "schema")]
impl utoipa::ToSchema for LexicalNodeId {}

#[cfg(feature = "schema")]
impl utoipa::PartialSchema for LexicalNodeId {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        <String as utoipa::PartialSchema>::schema()
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for LexicalNodeId {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::Type<sqlx::Postgres>>::type_info()
    }
    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <String as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::postgres::PgHasArrayType for LexicalNodeId {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::postgres::PgHasArrayType>::array_type_info()
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for LexicalNodeId {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        <String as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&self.as_str().to_owned(), buf)
    }
}

#[cfg(feature = "sqlx")]
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for LexicalNodeId {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <String as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(Self::try_new(value)?)
    }
}

#[cfg(test)]
mod test;
