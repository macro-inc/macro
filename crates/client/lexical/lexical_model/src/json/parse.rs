//! Typed node envelopes borrow unescaped strings; only extensible payloads retain JSON values.
use crate::collections::IndexMap;
use crate::*;
use serde::{
    Deserialize, Deserializer,
    de::{DeserializeSeed, MapAccess, SeqAccess, Visitor},
};
use serde_json::{Number, Value};
use std::{borrow::Cow, fmt};
mod install;

struct Document<'input> {
    root: ParsedNode<'input>,
}
impl<'input> Deserialize<'input> for Document<'input> {
    fn deserialize<D: Deserializer<'input>>(deserializer: D) -> Result<Self, D::Error> {
        struct DocumentVisitor;
        impl<'input> Visitor<'input> for DocumentVisitor {
            type Value = Document<'input>;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("struct SerializedEditorState")
            }
            fn visit_map<A: MapAccess<'input>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut root = None;
                while let Some(BorrowedString(key)) = map.next_key()? {
                    if key == "root" {
                        if root.is_some() {
                            return Err(serde::de::Error::duplicate_field("root"));
                        }
                        root = Some(map.next_value()?);
                    } else {
                        let _ = map.next_value::<serde::de::IgnoredAny>()?;
                    }
                }
                Ok(Document {
                    root: root.ok_or_else(|| serde::de::Error::missing_field("root"))?,
                })
            }
            fn visit_seq<A: SeqAccess<'input>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let root = seq
                    .next_element()?
                    .ok_or_else(|| serde::de::Error::invalid_length(0, &self))?;
                if seq.next_element::<serde::de::IgnoredAny>()?.is_some() {
                    return Err(serde::de::Error::invalid_length(2, &self));
                }
                Ok(Document { root })
            }
        }
        deserializer.deserialize_struct("SerializedEditorState", &["root"], DocumentVisitor)
    }
}

pub(super) fn editor_state(editor: &mut Editor, text: &str) -> Result<EditorState, Error> {
    let document: Document<'_> = serde_json::from_str(text)?;
    if document.root.string("type") != Some("root") {
        return Err(Error::ExpectedSerializedRoot);
    }
    let mut tx = editor.json_transaction()?;
    document.root.install(&mut tx)?;
    Ok(tx.pending.clone())
}

struct ParsedNode<'input> {
    fields: IndexMap<Cow<'input, str>, FieldValue<'input>>,
}

enum FieldValue<'input> {
    String(Cow<'input, str>),
    Children(Vec<Child<'input>>),
    Other(Value),
}
enum Child<'input> {
    Node(ParsedNode<'input>),
    Other(Value),
}

impl<'input> ParsedNode<'input> {
    fn from_map<A: MapAccess<'input>>(mut map: A) -> Result<Self, A::Error> {
        let mut fields =
            IndexMap::with_capacity_and_hasher(map.size_hint().unwrap_or(8), Default::default());
        while let Some(BorrowedString(key)) = map.next_key()? {
            let value = map.next_value_seed(FieldSeed {
                children: key == "children",
            })?;
            fields.insert(key, value);
        }
        Ok(Self { fields })
    }
    fn string(&self, key: &str) -> Option<&str> {
        match self.fields.get(key) {
            Some(FieldValue::String(text)) => Some(text),
            _ => None,
        }
    }
    fn number(&self, key: &str) -> u32 {
        match self.fields.get(key) {
            Some(FieldValue::Other(Value::Number(value))) => value
                .as_u64()
                .and_then(|value| u32::try_from(value).ok())
                .unwrap_or_default(),
            _ => 0,
        }
    }
    fn serialized(&self) -> SerializedNode {
        self.fields
            .iter()
            .map(|(key, value)| (key.to_string(), value.serialized()))
            .collect()
    }
}
impl FieldValue<'_> {
    fn into_serialized(self) -> Value {
        match self {
            Self::String(value) => Value::String(value.into_owned()),
            Self::Other(value) => value,
            Self::Children(children) => Value::Array(
                children
                    .into_iter()
                    .map(|child| match child {
                        Child::Node(node) => Value::Object(node.serialized()),
                        Child::Other(value) => value,
                    })
                    .collect(),
            ),
        }
    }
    fn serialized(&self) -> Value {
        match self {
            Self::String(value) => Value::String(value.to_string()),
            Self::Other(value) => value.clone(),
            Self::Children(children) => Value::Array(
                children
                    .iter()
                    .map(|child| match child {
                        Child::Node(node) => Value::Object(node.serialized()),
                        Child::Other(value) => value.clone(),
                    })
                    .collect(),
            ),
        }
    }
}

struct BorrowedString<'input>(Cow<'input, str>);
impl<'input> Deserialize<'input> for BorrowedString<'input> {
    fn deserialize<D: Deserializer<'input>>(deserializer: D) -> Result<Self, D::Error> {
        struct StringVisitor;
        impl<'input> Visitor<'input> for StringVisitor {
            type Value = BorrowedString<'input>;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a string")
            }
            fn visit_borrowed_str<E: serde::de::Error>(
                self,
                value: &'input str,
            ) -> Result<Self::Value, E> {
                Ok(BorrowedString(Cow::Borrowed(value)))
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(BorrowedString(Cow::Owned(value.to_owned())))
            }
            fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
                Ok(BorrowedString(Cow::Owned(value)))
            }
        }
        deserializer.deserialize_str(StringVisitor)
    }
}
impl<'input> Deserialize<'input> for ParsedNode<'input> {
    fn deserialize<D: Deserializer<'input>>(deserializer: D) -> Result<Self, D::Error> {
        struct NodeVisitor;
        impl<'input> Visitor<'input> for NodeVisitor {
            type Value = ParsedNode<'input>;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a map")
            }
            fn visit_map<A: MapAccess<'input>>(self, map: A) -> Result<Self::Value, A::Error> {
                ParsedNode::from_map(map)
            }
        }
        deserializer.deserialize_map(NodeVisitor)
    }
}

struct FieldSeed {
    children: bool,
}
impl<'input> DeserializeSeed<'input> for FieldSeed {
    type Value = FieldValue<'input>;
    fn deserialize<D: Deserializer<'input>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}
impl<'input> Visitor<'input> for FieldSeed {
    type Value = FieldValue<'input>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a JSON value")
    }
    fn visit_borrowed_str<E: serde::de::Error>(self, value: &'input str) -> Result<Self::Value, E> {
        Ok(FieldValue::String(Cow::Borrowed(value)))
    }
    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
        Ok(FieldValue::String(Cow::Owned(value.to_owned())))
    }
    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
        Ok(FieldValue::String(Cow::Owned(value)))
    }
    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
        Ok(FieldValue::Other(Value::Bool(value)))
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(FieldValue::Other(Value::Null))
    }
    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
        Ok(FieldValue::Other(Value::Number(value.into())))
    }
    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
        Ok(FieldValue::Other(Value::Number(value.into())))
    }
    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
        Number::from_f64(value)
            .map(|value| FieldValue::Other(Value::Number(value)))
            .ok_or_else(|| E::custom("number out of range"))
    }
    fn visit_map<A: MapAccess<'input>>(self, map: A) -> Result<Self::Value, A::Error> {
        Value::deserialize(serde::de::value::MapAccessDeserializer::new(map)).map(FieldValue::Other)
    }
    fn visit_seq<A: SeqAccess<'input>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        if !self.children {
            return Value::deserialize(serde::de::value::SeqAccessDeserializer::new(seq))
                .map(FieldValue::Other);
        }
        let mut children = Vec::new();
        while let Some(child) = seq.next_element_seed(ChildSeed)? {
            children.push(child);
        }
        Ok(FieldValue::Children(children))
    }
}
struct ChildSeed;
impl<'input> DeserializeSeed<'input> for ChildSeed {
    type Value = Child<'input>;
    fn deserialize<D: Deserializer<'input>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}
impl<'input> Visitor<'input> for ChildSeed {
    type Value = Child<'input>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a JSON value")
    }
    fn visit_map<A: MapAccess<'input>>(self, map: A) -> Result<Self::Value, A::Error> {
        ParsedNode::from_map(map).map(Child::Node)
    }
    fn visit_seq<A: SeqAccess<'input>>(self, seq: A) -> Result<Self::Value, A::Error> {
        Value::deserialize(serde::de::value::SeqAccessDeserializer::new(seq)).map(Child::Other)
    }
    fn visit_borrowed_str<E: serde::de::Error>(self, value: &'input str) -> Result<Self::Value, E> {
        Ok(Child::Other(Value::String(value.to_owned())))
    }
    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
        Ok(Child::Other(Value::String(value.to_owned())))
    }
    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
        Ok(Child::Other(Value::String(value)))
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(Child::Other(Value::Null))
    }
    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
        Ok(Child::Other(Value::Bool(value)))
    }
    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
        Ok(Child::Other(Value::Number(value.into())))
    }
    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
        Ok(Child::Other(Value::Number(value.into())))
    }
    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
        Number::from_f64(value)
            .map(|n| Child::Other(Value::Number(n)))
            .ok_or_else(|| E::custom("number out of range"))
    }
}

#[cfg(test)]
mod test;
