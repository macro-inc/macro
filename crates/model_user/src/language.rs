use serde::{Deserialize, Serialize};
use strum::{EnumIter, EnumString, IntoStaticStr};

/// A language the app's interface is available in, as a BCP 47 tag.
#[derive(
    Serialize,
    Deserialize,
    Eq,
    PartialEq,
    Debug,
    Clone,
    Copy,
    utoipa::ToSchema,
    EnumString,
    IntoStaticStr,
    EnumIter,
)]
pub enum Language {
    /// English
    #[serde(rename = "en")]
    #[strum(serialize = "en")]
    English,
    /// German
    #[serde(rename = "de")]
    #[strum(serialize = "de")]
    German,
    /// French
    #[serde(rename = "fr")]
    #[strum(serialize = "fr")]
    French,
    /// Spanish
    #[serde(rename = "es")]
    #[strum(serialize = "es")]
    Spanish,
    /// Italian
    #[serde(rename = "it")]
    #[strum(serialize = "it")]
    Italian,
    /// Dutch
    #[serde(rename = "nl")]
    #[strum(serialize = "nl")]
    Dutch,
    /// European Portuguese
    #[serde(rename = "pt-PT")]
    #[strum(serialize = "pt-PT")]
    PortuguesePortugal,
    /// Swedish
    #[serde(rename = "sv")]
    #[strum(serialize = "sv")]
    Swedish,
    /// Danish
    #[serde(rename = "da")]
    #[strum(serialize = "da")]
    Danish,
    /// Norwegian Bokmål
    #[serde(rename = "nb")]
    #[strum(serialize = "nb")]
    NorwegianBokmal,
    /// Finnish
    #[serde(rename = "fi")]
    #[strum(serialize = "fi")]
    Finnish,
    /// Polish
    #[serde(rename = "pl")]
    #[strum(serialize = "pl")]
    Polish,
    /// Russian
    #[serde(rename = "ru")]
    #[strum(serialize = "ru")]
    Russian,
    /// Japanese
    #[serde(rename = "ja")]
    #[strum(serialize = "ja")]
    Japanese,
    /// Korean
    #[serde(rename = "ko")]
    #[strum(serialize = "ko")]
    Korean,
    /// Simplified Chinese
    #[serde(rename = "zh-Hans")]
    #[strum(serialize = "zh-Hans")]
    ChineseSimplified,
    /// Traditional Chinese
    #[serde(rename = "zh-Hant")]
    #[strum(serialize = "zh-Hant")]
    ChineseTraditional,
    /// Hindi
    #[serde(rename = "hi")]
    #[strum(serialize = "hi")]
    Hindi,
    /// Indonesian
    #[serde(rename = "id")]
    #[strum(serialize = "id")]
    Indonesian,
    /// Vietnamese
    #[serde(rename = "vi")]
    #[strum(serialize = "vi")]
    Vietnamese,
    /// Thai
    #[serde(rename = "th")]
    #[strum(serialize = "th")]
    Thai,
}

impl Language {
    /// The BCP 47 tag stored in the database and sent over the wire.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

#[cfg(feature = "sqlx")]
mod postgres {
    use std::str::FromStr;

    use sqlx::{Decode, Encode, Postgres, Type};

    use super::Language;

    impl Type<Postgres> for Language {
        fn type_info() -> sqlx::postgres::PgTypeInfo {
            <String as Type<Postgres>>::type_info()
        }

        fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
            <String as Type<Postgres>>::compatible(ty)
        }
    }

    impl<'query> Encode<'query, Postgres> for Language {
        fn encode_by_ref(
            &self,
            buffer: &mut sqlx::postgres::PgArgumentBuffer,
        ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
            <&str as Encode<Postgres>>::encode_by_ref(&self.as_str(), buffer)
        }

        fn size_hint(&self) -> usize {
            self.as_str().len()
        }
    }

    impl<'row> Decode<'row, Postgres> for Language {
        fn decode(
            value: sqlx::postgres::PgValueRef<'row>,
        ) -> Result<Self, sqlx::error::BoxDynError> {
            let value = <String as Decode<Postgres>>::decode(value)?;
            Language::from_str(&value).map_err(Into::into)
        }
    }
}

#[cfg(test)]
mod test;
