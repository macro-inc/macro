//! Catch JS property access while retaining serde's lazy delivery and accounting.
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(inline_js = r#"
export function lexicalInputKind(value) {
    if (value === null || typeof value !== 'object') {
        return typeof value === 'function' || typeof value === 'symbol' ? 4 : 0;
    }
    if (Array.isArray(value)) return 1;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return 2;
    if (Symbol.iterator in value && !(value instanceof Map)) return 4;
    return 3;
}
export function lexicalInputLength(value) { return value.length >>> 0; }
export function lexicalInputGet(value, index) { return value[index]; }
export function lexicalInputBytes(value) {
    return new Uint8Array(value);
}
export function lexicalInputMap(value) {
    const method = value[Symbol.iterator];
    if (typeof method === 'function') {
        const iterator = method.call(value);
        if (iterator !== null && typeof iterator === 'object') return [iterator, null];
    }
    return [null, Object.entries(value)];
}
export function lexicalInputNext(iterator) {
    const result = iterator.next();
    if (result.done) return [true];
    const pair = result.value;
    return [false, pair[0], pair[1]];
}
"#)]
extern "C" {
    #[wasm_bindgen(catch, js_name = lexicalInputKind)]
    fn kind(value: &JsValue) -> Result<u8, JsValue>;
    #[wasm_bindgen(catch, js_name = lexicalInputLength)]
    fn length(value: &JsValue) -> Result<u32, JsValue>;
    #[wasm_bindgen(catch, js_name = lexicalInputGet)]
    fn get(value: &JsValue, index: u32) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_name = lexicalInputBytes)]
    fn bytes(value: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_name = lexicalInputMap)]
    fn map(value: &JsValue) -> Result<js_sys::Array, JsValue>;
    #[wasm_bindgen(catch, js_name = lexicalInputNext)]
    fn next(iterator: &JsValue) -> Result<js_sys::Array, JsValue>;
}

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error(transparent)]
    Serde(#[from] serde_wasm_bindgen::Error),
    #[error("JS input accessor threw")]
    Opaque(JsValue),
}
impl serde::de::Error for Error {
    fn custom<T: std::fmt::Display>(message: T) -> Self {
        Self::Serde(<serde_wasm_bindgen::Error as serde::de::Error>::custom(
            message,
        ))
    }
}
impl From<JsValue> for Error {
    fn from(error: JsValue) -> Self {
        Self::Opaque(crate::debug::returned_handle(error))
    }
}

pub(crate) fn value(value: JsValue) -> Result<serde_json::Value, JsValue> {
    super::value(Input(value), &crate::debug::add_bytes).map_err(|error| match error {
        Error::Serde(error) => crate::debug::error(error).into(),
        Error::Opaque(error) => crate::debug::returned_handle(error),
    })
}

struct Input(JsValue);
impl<'de> serde::Deserializer<'de> for Input {
    type Error = Error;
    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> {
        match kind(&self.0)? {
            0 => serde_wasm_bindgen::Deserializer::from(self.0)
                .deserialize_any(visitor)
                .map_err(Error::Serde),
            1 => {
                let end = length(&self.0)?;
                visitor.visit_seq(Array {
                    value: self.0,
                    index: 0,
                    end,
                })
            }
            2 => serde_wasm_bindgen::Deserializer::from(bytes(&self.0)?)
                .deserialize_any(visitor)
                .map_err(Error::Serde),
            3 => {
                let source = map(&self.0)?;
                let iterator = source.get(0);
                let source = if iterator.is_null() {
                    let entries: js_sys::Array = source.get(1).unchecked_into();
                    Source::Entries {
                        end: entries.length(),
                        entries,
                        index: 0,
                    }
                } else {
                    Source::Iterator(iterator)
                };
                visitor.visit_map(Object {
                    source,
                    value: None,
                })
            }
            _ => Err(<Error as serde::de::Error>::custom(
                "unsupported JS value in indexed JSON input",
            )),
        }
    }
    fn deserialize_string<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> {
        if kind(&self.0)? == 0 {
            serde_wasm_bindgen::Deserializer::from(self.0)
                .deserialize_string(visitor)
                .map_err(Error::Serde)
        } else {
            Err(<Error as serde::de::Error>::custom(
                "indexed JSON object keys must be strings",
            ))
        }
    }
    fn deserialize_str<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> {
        self.deserialize_string(visitor)
    }
    fn deserialize_identifier<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> {
        self.deserialize_string(visitor)
    }
    // This adapter is private to serde_json::Value and its String map keys.
    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 char bytes byte_buf option
        unit unit_struct newtype_struct seq tuple tuple_struct map struct enum ignored_any
    }
}
struct Array {
    value: JsValue,
    index: u32,
    end: u32,
}
impl<'de> SeqAccess<'de> for Array {
    type Error = Error;
    fn next_element_seed<T: DeserializeSeed<'de>>(
        &mut self,
        seed: T,
    ) -> Result<Option<T::Value>, Error> {
        if self.index == self.end {
            return Ok(None);
        }
        let value = get(&self.value, self.index)?;
        self.index += 1;
        seed.deserialize(Input(value)).map(Some)
    }
    fn size_hint(&self) -> Option<usize> {
        Some((self.end - self.index) as usize)
    }
}
enum Source {
    Entries {
        entries: js_sys::Array,
        index: u32,
        end: u32,
    },
    Iterator(JsValue),
}
struct Object {
    source: Source,
    value: Option<JsValue>,
}
impl<'de> MapAccess<'de> for Object {
    type Error = Error;
    fn next_key_seed<K: DeserializeSeed<'de>>(
        &mut self,
        seed: K,
    ) -> Result<Option<K::Value>, Error> {
        let (key, value) = match &mut self.source {
            Source::Entries {
                entries,
                index,
                end,
            } => {
                if *index == *end {
                    return Ok(None);
                }
                // Object.entries created these rows; their own indices are data properties.
                let pair: js_sys::Array = entries.get(*index).unchecked_into();
                *index += 1;
                (pair.get(0), pair.get(1))
            }
            Source::Iterator(iterator) => {
                let row = next(iterator)?;
                if row.get(0).is_truthy() {
                    return Ok(None);
                }
                (row.get(1), row.get(2))
            }
        };
        self.value = Some(value);
        seed.deserialize(Input(key)).map(Some)
    }
    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, Error> {
        let value = self
            .value
            .take()
            .ok_or_else(|| <Error as serde::de::Error>::custom("map value without a key"))?;
        seed.deserialize(Input(value))
    }
}
