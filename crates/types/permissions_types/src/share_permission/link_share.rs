use std::str::FromStr;

use sqlx::{Decode, Encode, Postgres, Type};
use utoipa::ToSchema;

/// Defines who can access an item through its share link.
#[derive(
    serde::Serialize,
    serde::Deserialize,
    Eq,
    PartialEq,
    Debug,
    ToSchema,
    Clone,
    Copy,
    strum::EnumString,
    strum::Display,
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum LinkShare {
    /// Anyone with the link can access the item.
    Public,
    /// Members of the owner's team with the link can access the item.
    Team,
}

impl LinkShare {
    fn as_str(self) -> &'static str {
        match self {
            Self::Public => "PUBLIC",
            Self::Team => "TEAM",
        }
    }
}

impl Type<Postgres> for LinkShare {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <String as Type<Postgres>>::type_info()
    }

    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <String as Type<Postgres>>::compatible(ty)
    }
}

impl<'query> Encode<'query, Postgres> for LinkShare {
    fn encode_by_ref(
        &self,
        buffer: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        let value = self.as_str();
        <&str as Encode<Postgres>>::encode_by_ref(&value, buffer)
    }

    fn size_hint(&self) -> usize {
        self.as_str().len()
    }
}

impl<'row> Decode<'row, Postgres> for LinkShare {
    fn decode(value: sqlx::postgres::PgValueRef<'row>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <String as Decode<Postgres>>::decode(value)?;
        LinkShare::from_str(&value).map_err(Into::into)
    }
}

#[cfg(test)]
mod test;
