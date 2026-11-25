//! Stored value representation: entity keys, field keys, records and cache
//! values.

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;

/// Key of a normalized record: `"Typename:keyValue"`, or [`ROOT_QUERY`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EntityKey<'a>(pub Cow<'a, str>);

/// The singleton record holding root-level query fields (graphcache's
/// `Query` record). Field keys on it embed arguments, e.g.
/// `soup({"input":{...}})`.
pub const ROOT_QUERY: &str = "ROOT_QUERY";

impl EntityKey<'static> {
    pub fn root() -> Self {
        EntityKey(Cow::Borrowed(ROOT_QUERY))
    }

    pub fn entity(typename: &str, key_values: &[&str]) -> Self {
        let mut s = String::with_capacity(typename.len() + 16);
        s.push_str(typename);
        for v in key_values {
            s.push(':');
            s.push_str(v);
        }
        EntityKey(s.into())
    }
}

impl<'a> EntityKey<'a> {
    /// The `Typename` half of an entity key; `None` for the root record.
    pub fn typename(&self) -> Option<&str> {
        self.0.split_once(':').map(|(typename, _)| typename)
    }

    /// The key-value half of an entity key; `None` for the root record.
    pub fn id(&self) -> Option<&str> {
        self.0.split_once(':').map(|(_, id)| id)
    }

    pub fn is_root(&self) -> bool {
        self.0 == ROOT_QUERY
    }

    pub fn borrowed(&self) -> EntityKey<'_> {
        EntityKey(Cow::Borrowed(self.0.as_ref()))
    }

    /// Converts this key into an owned key that can be stored independently.
    pub fn into_owned(self) -> EntityKey<'static> {
        EntityKey(Cow::Owned(self.0.into_owned()))
    }
}

impl AsRef<str> for EntityKey<'_> {
    fn as_ref(&self) -> &str {
        self.0.as_ref()
    }
}

impl<'a> fmt::Display for EntityKey<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Storage key of a field within a record: `name` or `name({canonicalArgs})`.
pub type FieldKey = String;

/// Builds a field storage key from the field name and resolved, canonical
/// argument JSON (sorted object keys). `args` must already be canonical.
pub fn field_key(name: &str, args: Option<&str>) -> FieldKey {
    match args {
        None => name.to_string(),
        Some(a) => format!("{name}({a})"),
    }
}

/// A JSON number in a postcard-serializable representation
/// (`serde_json::Number` requires self-describing formats).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum CacheNumber {
    PosInt(u64),
    NegInt(i64),
    Float(f64),
}

impl From<&serde_json::Number> for CacheNumber {
    fn from(n: &serde_json::Number) -> Self {
        if let Some(u) = n.as_u64() {
            CacheNumber::PosInt(u)
        } else if let Some(i) = n.as_i64() {
            CacheNumber::NegInt(i)
        } else {
            CacheNumber::Float(n.as_f64().expect("number is u64, i64 or f64"))
        }
    }
}

impl CacheNumber {
    pub fn to_json(self) -> serde_json::Number {
        match self {
            CacheNumber::PosInt(u) => serde_json::Number::from(u),
            CacheNumber::NegInt(i) => serde_json::Number::from(i),
            CacheNumber::Float(f) => {
                serde_json::Number::from_f64(f).expect("stored floats are finite")
            }
        }
    }
}

/// A value stored inside a record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CacheValue {
    Null,
    Bool(bool),
    Number(CacheNumber),
    String(String),
    /// Link to another normalized record.
    Ref(EntityKey<'static>),
    /// Embedded (non-keyable) object. `__typename` is stored as a regular
    /// field when known, for fragment matching on read.
    Object(#[serde(deserialize_with = "deserialize_fields")] BTreeMap<FieldKey, CacheValue>),
    List(Vec<CacheValue>),
    /// Opaque custom-scalar blob (e.g. `JSON`) as canonical JSON text
    /// (canonical → comparable; text → postcard-serializable).
    Opaque(String),
}

impl CacheValue {
    /// Wraps an opaque custom-scalar JSON value.
    pub fn opaque(value: &serde_json::Value) -> Self {
        CacheValue::Opaque(canonical_json(value))
    }
}

/// A normalized record: field key → value.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Record {
    #[serde(deserialize_with = "deserialize_fields")]
    pub fields: BTreeMap<FieldKey, CacheValue>,
}

impl Record {
    /// Merges `other` into `self` field-by-field (new values replace old;
    /// lists and embedded objects are replaced wholesale, graphcache
    /// semantics). Returns true when anything changed.
    pub fn merge(&mut self, other: Record) -> bool {
        let recent_pages = crate::page_retention::updated_pages(self, &other);
        let mut changed = false;
        for (k, v) in other.fields {
            // Incoming snapshots must not replace the base's recency history.
            if k == crate::page_retention::PAGE_ORDER_FIELD {
                continue;
            }
            match self.fields.get(&k) {
                Some(existing) if *existing == v => {}
                _ => {
                    self.fields.insert(k, v);
                    changed = true;
                }
            }
        }
        crate::page_retention::retain_soup_pages(self, &recent_pages) || changed
    }

    pub fn typename(&self) -> Option<&str> {
        match self.fields.get("__typename") {
            Some(CacheValue::String(s)) => Some(s),
            _ => None,
        }
    }
}

/// Canonical JSON serialization: object keys sorted, no whitespace. Used for
/// argument field keys and operation hashing so logically-equal inputs
/// collide.
pub fn canonical_json(value: &serde_json::Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            out.push('{');
            for (i, (k, v)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).expect("string serializes"));
                out.push(':');
                write_canonical(v, out);
            }
            out.push('}');
        }
        serde_json::Value::Array(items) => {
            out.push('[');
            for (i, v) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(v, out);
            }
            out.push(']');
        }
        other => out.push_str(&serde_json::to_string(other).expect("scalar serializes")),
    }
}

#[cfg(test)]
mod test;

/// Deserializes a field map by building it from all its entries at once.
///
/// Stored maps arrive in key order, so a bulk build skips the per-key search
/// and node splits that inserting one entry at a time costs. A map whose keys
/// are out of order or repeated falls back to inserting one by one, so a
/// repeated key keeps its last value and holds one entry.
fn deserialize_fields<'de, D>(deserializer: D) -> Result<BTreeMap<FieldKey, CacheValue>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct FieldsVisitor;

    impl<'de> serde::de::Visitor<'de> for FieldsVisitor {
        type Value = BTreeMap<FieldKey, CacheValue>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a map")
        }

        fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::MapAccess<'de>,
        {
            let mut entries: Vec<(FieldKey, CacheValue)> =
                Vec::with_capacity(map.size_hint().unwrap_or(0).min(1024));
            while let Some((key, value)) = map.next_entry::<FieldKey, CacheValue>()? {
                if entries.last().is_some_and(|(last, _)| *last >= key) {
                    // Out of order or repeated: insert the rest one by one, so a
                    // repeated key replaces its value instead of piling up.
                    let mut fields: BTreeMap<_, _> = entries.into_iter().collect();
                    fields.insert(key, value);
                    while let Some((key, value)) = map.next_entry()? {
                        fields.insert(key, value);
                    }
                    return Ok(fields);
                }
                entries.push((key, value));
            }
            Ok(entries.into_iter().collect())
        }
    }

    deserializer.deserialize_map(FieldsVisitor)
}
