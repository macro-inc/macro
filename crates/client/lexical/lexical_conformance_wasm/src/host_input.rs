//! Observe values as serde copies them, including prefixes of failed input.
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::fmt;
#[cfg(target_arch = "wasm32")]
mod safe;
#[cfg(target_arch = "wasm32")]
pub(super) use safe::value as from_js;

pub(super) fn value<'de, D: Deserializer<'de>>(
    deserializer: D,
    count: &impl Fn(u64),
) -> Result<serde_json::Value, D::Error> {
    serde_json::Value::deserialize(Counted {
        inner: deserializer,
        count,
    })
}

struct Counted<'count, T, F> {
    inner: T,
    count: &'count F,
}

// Forward each request unchanged; wrapping deserialize_any alone would change
// typed map-key errors and could skip recursively requested values.
macro_rules! deserialize {
    ($($name:ident $(($($arg:ident: $ty:ty),*))?;)*) => {$ (
        fn $name<V: Visitor<'de>>(self, $($($arg: $ty,)*)? visitor: V) -> Result<V::Value, Self::Error> {
            self.inner.$name($($($arg,)*)? Counted { inner: visitor, count: self.count })
        }
    )*};
}
impl<'de, D: Deserializer<'de>, F: Fn(u64)> Deserializer<'de> for Counted<'_, D, F> {
    type Error = D::Error;
    deserialize! {
        deserialize_any;
        deserialize_bool;
        deserialize_i8;
        deserialize_i16;
        deserialize_i32;
        deserialize_i64;
        deserialize_i128;
        deserialize_u8;
        deserialize_u16;
        deserialize_u32;
        deserialize_u64;
        deserialize_u128;
        deserialize_f32;
        deserialize_f64;
        deserialize_char;
        deserialize_str;
        deserialize_string;
        deserialize_bytes;
        deserialize_byte_buf;
        deserialize_option;
        deserialize_unit;
        deserialize_seq;
        deserialize_map;
        deserialize_identifier;
        deserialize_ignored_any;
        deserialize_unit_struct(name: &'static str);
        deserialize_newtype_struct(name: &'static str);
        deserialize_tuple(len: usize);
        deserialize_tuple_struct(name: &'static str, len: usize);
        deserialize_struct(name: &'static str, fields: &'static [&'static str]);
        deserialize_enum(name: &'static str, variants: &'static [&'static str]);
    }
    fn is_human_readable(&self) -> bool {
        self.inner.is_human_readable()
    }
}

macro_rules! scalar {
    ($($method:ident($ty:ty, $bytes:expr);)*) => {$ (
        fn $method<E: serde::de::Error>(self, value: $ty) -> Result<Self::Value, E> {
            (self.count)($bytes);
            self.inner.$method(value)
        }
    )*};
}
impl<'de, V: Visitor<'de>, F: Fn(u64)> Visitor<'de> for Counted<'_, V, F> {
    type Value = V::Value;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.expecting(formatter)
    }
    scalar! {
        visit_bool(bool, 1);
        visit_i8(i8, 8);
        visit_i16(i16, 8);
        visit_i32(i32, 8);
        visit_i64(i64, 8);
        visit_i128(i128, 8);
        visit_u8(u8, 8);
        visit_u16(u16, 8);
        visit_u32(u32, 8);
        visit_u64(u64, 8);
        visit_u128(u128, 8);
        visit_f32(f32, 8);
        visit_f64(f64, 8);
    }
    fn visit_char<E: serde::de::Error>(self, value: char) -> Result<Self::Value, E> {
        (self.count)(value.len_utf16() as u64 * 2);
        self.inner.visit_char(value)
    }
    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
        (self.count)(value.encode_utf16().count() as u64 * 2);
        self.inner.visit_str(value)
    }
    fn visit_borrowed_str<E: serde::de::Error>(self, value: &'de str) -> Result<Self::Value, E> {
        (self.count)(value.encode_utf16().count() as u64 * 2);
        self.inner.visit_borrowed_str(value)
    }
    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
        (self.count)(value.encode_utf16().count() as u64 * 2);
        self.inner.visit_string(value)
    }
    fn visit_bytes<E: serde::de::Error>(self, value: &[u8]) -> Result<Self::Value, E> {
        (self.count)(value.len() as u64);
        self.inner.visit_bytes(value)
    }
    fn visit_borrowed_bytes<E: serde::de::Error>(self, value: &'de [u8]) -> Result<Self::Value, E> {
        (self.count)(value.len() as u64);
        self.inner.visit_borrowed_bytes(value)
    }
    fn visit_byte_buf<E: serde::de::Error>(self, value: Vec<u8>) -> Result<Self::Value, E> {
        (self.count)(value.len() as u64);
        self.inner.visit_byte_buf(value)
    }
    fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        self.inner.visit_none()
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        self.inner.visit_unit()
    }
    fn visit_some<D: Deserializer<'de>>(self, inner: D) -> Result<Self::Value, D::Error> {
        self.inner.visit_some(Counted {
            inner,
            count: self.count,
        })
    }
    fn visit_newtype_struct<D: Deserializer<'de>>(self, inner: D) -> Result<Self::Value, D::Error> {
        self.inner.visit_newtype_struct(Counted {
            inner,
            count: self.count,
        })
    }
    fn visit_seq<A: SeqAccess<'de>>(self, inner: A) -> Result<Self::Value, A::Error> {
        self.inner.visit_seq(Counted {
            inner,
            count: self.count,
        })
    }
    fn visit_map<A: MapAccess<'de>>(self, inner: A) -> Result<Self::Value, A::Error> {
        self.inner.visit_map(Counted {
            inner,
            count: self.count,
        })
    }
}
impl<'de, S: DeserializeSeed<'de>, F: Fn(u64)> DeserializeSeed<'de> for Counted<'_, S, F> {
    type Value = S::Value;
    fn deserialize<D: Deserializer<'de>>(self, inner: D) -> Result<Self::Value, D::Error> {
        self.inner.deserialize(Counted {
            inner,
            count: self.count,
        })
    }
}
impl<'de, A: SeqAccess<'de>, F: Fn(u64)> SeqAccess<'de> for Counted<'_, A, F> {
    type Error = A::Error;
    fn next_element_seed<S: DeserializeSeed<'de>>(
        &mut self,
        inner: S,
    ) -> Result<Option<S::Value>, Self::Error> {
        self.inner.next_element_seed(Counted {
            inner,
            count: self.count,
        })
    }
    fn size_hint(&self) -> Option<usize> {
        self.inner.size_hint()
    }
}
impl<'de, A: MapAccess<'de>, F: Fn(u64)> MapAccess<'de> for Counted<'_, A, F> {
    type Error = A::Error;
    fn next_key_seed<S: DeserializeSeed<'de>>(
        &mut self,
        inner: S,
    ) -> Result<Option<S::Value>, Self::Error> {
        self.inner.next_key_seed(Counted {
            inner,
            count: self.count,
        })
    }
    fn next_value_seed<S: DeserializeSeed<'de>>(
        &mut self,
        inner: S,
    ) -> Result<S::Value, Self::Error> {
        self.inner.next_value_seed(Counted {
            inner,
            count: self.count,
        })
    }
    fn size_hint(&self) -> Option<usize> {
        self.inner.size_hint()
    }
}

#[cfg(test)]
mod test;
