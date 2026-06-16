#![deny(missing_docs)]

//! This crate creates a standardized way to load a service config from environment variables.

extern crate self as macro_config;

pub use macro_config_derive::MacroConfig;

use serde::de::{
    self, DeserializeOwned, DeserializeSeed, Error as _, IntoDeserializer, MapAccess, Visitor,
};
use serde_json::Value;
use std::fmt::Display;

#[doc(hidden)]
pub use serde as __serde;
use std::str::FromStr;

#[cfg(test)]
mod test;

/// Extract a narrowed value out of a larger config struct `E`.
///
/// `#[derive(MacroConfig)]` generates one impl per field tagged with `#[from_ref]` (or every
/// field when the struct is tagged `#[from_ref_all]`), so a consumer can require just the
/// values it needs via a bound like `where AnthropicApiKey: FromRef<E>` instead of depending
/// on a concrete config type. Field types covered by `FromRef` must be distinct, since the
/// impl is keyed on the field's type.
pub trait FromRef<E> {
    /// Build `Self` from a reference to the config struct.
    fn from_ref(env: &E) -> Self;
}

/// Typed result
pub type MacroConfigResult<T> = Result<T, MacroConfigError>;

/// Macro config errors
#[derive(Debug, thiserror::Error)]
pub enum MacroConfigError {
    /// Missing required value
    #[error("missing required value: {0}")]
    MissingRequiredValue(&'static str),
    /// Failed to deserialize a config value
    #[error("failed to deserialize config value: {0}")]
    Deserialize(String),
}

impl MacroConfigError {
    fn invalid_value(
        key: &'static str,
        expected: &'static str,
        error: impl Display,
    ) -> MacroConfigError {
        MacroConfigError::Deserialize(format!(
            "failed to deserialize config key `{key}` as {expected}: {error}"
        ))
    }
}

impl de::Error for MacroConfigError {
    fn custom<T>(msg: T) -> Self
    where
        T: Display,
    {
        MacroConfigError::Deserialize(msg.to_string())
    }
}

/// Loads strongly typed config structs from config values.
///
/// Field names come from Serde, so attributes like `rename` and `rename_all` are respected when
/// looking up environment keys.
#[derive(Debug, Default, Clone, Copy)]
pub struct ConfigLoader;

impl ConfigLoader {
    /// Loads a config struct from `APP_SECRETS_JSON` or environment variables.
    ///
    /// Non-`Option` fields are loaded with [`required_config_value`]. `Option` fields are loaded
    /// with [`optional_config_value`].
    pub fn load<T>() -> MacroConfigResult<T>
    where
        T: DeserializeOwned,
    {
        serde::Deserialize::deserialize(ConfigDeserializer)
    }
}

/// Loads a config struct from `APP_SECRETS_JSON` or environment variables.
///
/// This is a convenience wrapper around [`ConfigLoader::load`].
pub fn load<T>() -> MacroConfigResult<T>
where
    T: DeserializeOwned,
{
    ConfigLoader::load()
}

/// Reads the value from app secrets json env var.
/// If `APP_SECRETS_JSON` is not present, tries to read from standard env var.
fn read_config_value(key: &'static str) -> Option<String> {
    match std::env::var("APP_SECRETS_JSON") {
        Ok(raw) => {
            let json = serde_json::from_str::<Value>(&raw)
                .unwrap_or_else(|error| panic!("APP_SECRETS_JSON contains invalid JSON: {error}"));

            json.get(key).cloned().map(|value| match value {
                Value::String(s) => s,
                other => other.to_string(),
            })
        }
        Err(std::env::VarError::NotPresent) => std::env::var(key).ok(),
        Err(error) => panic!("failed to read APP_SECRETS_JSON: {error}"),
    }
}

/// Get a required value
fn required_config_value(key: &'static str) -> MacroConfigResult<String> {
    read_config_value(key).ok_or(MacroConfigError::MissingRequiredValue(key))
}

/// Get an optional value
fn optional_config_value(key: &'static str) -> Option<String> {
    read_config_value(key)
}

struct ConfigDeserializer;

impl<'de> de::Deserializer<'de> for ConfigDeserializer {
    type Error = MacroConfigError;

    fn deserialize_any<V>(self, _visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        Err(MacroConfigError::Deserialize(
            "ConfigLoader can only load struct types".to_string(),
        ))
    }

    fn deserialize_struct<V>(
        self,
        _name: &'static str,
        fields: &'static [&'static str],
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_map(ConfigMapAccess {
            fields,
            next_field: 0,
            current_key: None,
        })
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes
        byte_buf option unit unit_struct newtype_struct seq tuple tuple_struct map enum
        identifier ignored_any
    }
}

struct ConfigMapAccess {
    fields: &'static [&'static str],
    next_field: usize,
    current_key: Option<&'static str>,
}

impl<'de> MapAccess<'de> for ConfigMapAccess {
    type Error = MacroConfigError;

    fn next_key_seed<K>(&mut self, seed: K) -> MacroConfigResult<Option<K::Value>>
    where
        K: DeserializeSeed<'de>,
    {
        let Some(key) = self.fields.get(self.next_field).copied() else {
            return Ok(None);
        };

        self.next_field += 1;
        self.current_key = Some(key);
        seed.deserialize(key.into_deserializer()).map(Some)
    }

    fn next_value_seed<V>(&mut self, seed: V) -> MacroConfigResult<V::Value>
    where
        V: DeserializeSeed<'de>,
    {
        let key = self.current_key.take().ok_or_else(|| {
            MacroConfigError::Deserialize("config value requested before config key".to_string())
        })?;

        seed.deserialize(ConfigValueDeserializer { key })
    }

    fn size_hint(&self) -> Option<usize> {
        Some(self.fields.len().saturating_sub(self.next_field))
    }
}

struct ConfigValueDeserializer {
    key: &'static str,
}

impl ConfigValueDeserializer {
    fn required_value(self) -> MacroConfigResult<ConfigRawValueDeserializer> {
        required_config_value(self.key).map(|value| ConfigRawValueDeserializer {
            key: self.key,
            value,
        })
    }
}

impl<'de> de::Deserializer<'de> for ConfigValueDeserializer {
    type Error = MacroConfigError;

    fn deserialize_any<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_any(visitor)
    }

    fn deserialize_bool<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_bool(visitor)
    }

    fn deserialize_i8<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_i8(visitor)
    }

    fn deserialize_i16<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_i16(visitor)
    }

    fn deserialize_i32<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_i32(visitor)
    }

    fn deserialize_i64<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_i64(visitor)
    }

    fn deserialize_i128<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_i128(visitor)
    }

    fn deserialize_u8<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_u8(visitor)
    }

    fn deserialize_u16<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_u16(visitor)
    }

    fn deserialize_u32<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_u32(visitor)
    }

    fn deserialize_u64<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_u64(visitor)
    }

    fn deserialize_u128<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_u128(visitor)
    }

    fn deserialize_f32<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_f32(visitor)
    }

    fn deserialize_f64<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_f64(visitor)
    }

    fn deserialize_char<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_char(visitor)
    }

    fn deserialize_str<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_str(visitor)
    }

    fn deserialize_string<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_string(visitor)
    }

    fn deserialize_bytes<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_bytes(visitor)
    }

    fn deserialize_byte_buf<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_byte_buf(visitor)
    }

    fn deserialize_option<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        match optional_config_value(self.key) {
            Some(value) if value == "null" => visitor.visit_none(),
            Some(value) => visitor.visit_some(ConfigRawValueDeserializer {
                key: self.key,
                value,
            }),
            None => visitor.visit_none(),
        }
    }

    fn deserialize_unit<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_unit(visitor)
    }

    fn deserialize_unit_struct<V>(
        self,
        name: &'static str,
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?
            .deserialize_unit_struct(name, visitor)
    }

    fn deserialize_newtype_struct<V>(
        self,
        name: &'static str,
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?
            .deserialize_newtype_struct(name, visitor)
    }

    fn deserialize_seq<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_seq(visitor)
    }

    fn deserialize_tuple<V>(self, len: usize, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_tuple(len, visitor)
    }

    fn deserialize_tuple_struct<V>(
        self,
        name: &'static str,
        len: usize,
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?
            .deserialize_tuple_struct(name, len, visitor)
    }

    fn deserialize_map<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_map(visitor)
    }

    fn deserialize_struct<V>(
        self,
        name: &'static str,
        fields: &'static [&'static str],
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?
            .deserialize_struct(name, fields, visitor)
    }

    fn deserialize_enum<V>(
        self,
        name: &'static str,
        variants: &'static [&'static str],
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?
            .deserialize_enum(name, variants, visitor)
    }

    fn deserialize_identifier<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_identifier(visitor)
    }

    fn deserialize_ignored_any<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.required_value()?.deserialize_ignored_any(visitor)
    }
}

struct ConfigRawValueDeserializer {
    key: &'static str,
    value: String,
}

impl ConfigRawValueDeserializer {
    fn parse<T>(self, expected: &'static str) -> MacroConfigResult<T>
    where
        T: FromStr,
        T::Err: Display,
    {
        self.value
            .parse()
            .map_err(|error| MacroConfigError::invalid_value(self.key, expected, error))
    }

    fn parse_json(self, expected: &'static str) -> MacroConfigResult<Value> {
        serde_json::from_str(&self.value)
            .map_err(|error| MacroConfigError::invalid_value(self.key, expected, error))
    }
}

impl<'de> de::Deserializer<'de> for ConfigRawValueDeserializer {
    type Error = MacroConfigError;

    fn deserialize_any<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        match serde_json::from_str::<Value>(&self.value) {
            Ok(value) => value
                .deserialize_any(visitor)
                .map_err(MacroConfigError::custom),
            Err(_) => visitor.visit_string(self.value),
        }
    }

    fn deserialize_bool<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_bool(self.parse("bool")?)
    }

    fn deserialize_i8<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_i8(self.parse("i8")?)
    }

    fn deserialize_i16<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_i16(self.parse("i16")?)
    }

    fn deserialize_i32<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_i32(self.parse("i32")?)
    }

    fn deserialize_i64<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_i64(self.parse("i64")?)
    }

    fn deserialize_i128<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_i128(self.parse("i128")?)
    }

    fn deserialize_u8<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_u8(self.parse("u8")?)
    }

    fn deserialize_u16<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_u16(self.parse("u16")?)
    }

    fn deserialize_u32<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_u32(self.parse("u32")?)
    }

    fn deserialize_u64<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_u64(self.parse("u64")?)
    }

    fn deserialize_u128<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_u128(self.parse("u128")?)
    }

    fn deserialize_f32<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_f32(self.parse("f32")?)
    }

    fn deserialize_f64<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_f64(self.parse("f64")?)
    }

    fn deserialize_char<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        let mut chars = self.value.chars();
        let Some(char_value) = chars.next() else {
            return Err(MacroConfigError::invalid_value(
                self.key,
                "char",
                "expected a single character",
            ));
        };

        if chars.next().is_some() {
            return Err(MacroConfigError::invalid_value(
                self.key,
                "char",
                "expected a single character",
            ));
        }

        visitor.visit_char(char_value)
    }

    fn deserialize_str<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_string(self.value)
    }

    fn deserialize_string<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_string(self.value)
    }

    fn deserialize_bytes<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_byte_buf(self.value.into_bytes())
    }

    fn deserialize_byte_buf<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_byte_buf(self.value.into_bytes())
    }

    fn deserialize_option<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        if self.value == "null" {
            visitor.visit_none()
        } else {
            visitor.visit_some(self)
        }
    }

    fn deserialize_unit<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        if self.value.is_empty() || self.value == "null" {
            visitor.visit_unit()
        } else {
            Err(MacroConfigError::invalid_value(
                self.key,
                "unit",
                "expected empty string or null",
            ))
        }
    }

    fn deserialize_unit_struct<V>(
        self,
        _name: &'static str,
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.deserialize_unit(visitor)
    }

    fn deserialize_newtype_struct<V>(
        self,
        _name: &'static str,
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_newtype_struct(self)
    }

    fn deserialize_seq<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.parse_json("JSON array")?
            .deserialize_seq(visitor)
            .map_err(MacroConfigError::custom)
    }

    fn deserialize_tuple<V>(self, len: usize, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.parse_json("JSON array")?
            .deserialize_tuple(len, visitor)
            .map_err(MacroConfigError::custom)
    }

    fn deserialize_tuple_struct<V>(
        self,
        name: &'static str,
        len: usize,
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.parse_json("JSON array")?
            .deserialize_tuple_struct(name, len, visitor)
            .map_err(MacroConfigError::custom)
    }

    fn deserialize_map<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.parse_json("JSON object")?
            .deserialize_map(visitor)
            .map_err(MacroConfigError::custom)
    }

    fn deserialize_struct<V>(
        self,
        name: &'static str,
        fields: &'static [&'static str],
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        self.parse_json("JSON object")?
            .deserialize_struct(name, fields, visitor)
            .map_err(MacroConfigError::custom)
    }

    fn deserialize_enum<V>(
        self,
        name: &'static str,
        variants: &'static [&'static str],
        visitor: V,
    ) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        match serde_json::from_str::<Value>(&self.value) {
            Ok(value) => value
                .deserialize_enum(name, variants, visitor)
                .map_err(MacroConfigError::custom),
            Err(_) => visitor.visit_enum(self.value.into_deserializer()),
        }
    }

    fn deserialize_identifier<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_string(self.value)
    }

    fn deserialize_ignored_any<V>(self, visitor: V) -> MacroConfigResult<V::Value>
    where
        V: Visitor<'de>,
    {
        visitor.visit_unit()
    }
}
