//! Stored value representation: entity keys, field keys, records and cache
//! values.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

/// Key of a normalized record: `"Typename:keyValue"`, or [`ROOT_QUERY`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EntityKey(pub String);

/// The singleton record holding root-level query fields (graphcache's
/// `Query` record). Field keys on it embed arguments, e.g.
/// `soup({"input":{...}})`.
pub const ROOT_QUERY: &str = "ROOT_QUERY";

impl EntityKey {
    pub fn root() -> Self {
        EntityKey(ROOT_QUERY.to_string())
    }

    pub fn entity(typename: &str, key_values: &[&str]) -> Self {
        let mut s = String::with_capacity(typename.len() + 16);
        s.push_str(typename);
        for v in key_values {
            s.push(':');
            s.push_str(v);
        }
        EntityKey(s)
    }

    pub fn is_root(&self) -> bool {
        self.0 == ROOT_QUERY
    }
}

impl fmt::Display for EntityKey {
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

/// A value stored inside a record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CacheValue {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    /// Link to another normalized record.
    Ref(EntityKey),
    /// Embedded (non-keyable) object. `__typename` is stored as a regular
    /// field when known, for fragment matching on read.
    Object(BTreeMap<FieldKey, CacheValue>),
    List(Vec<CacheValue>),
    /// Opaque custom-scalar blob (e.g. `JSON`), stored verbatim.
    Opaque(serde_json::Value),
}

/// A normalized record: field key → value.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Record {
    pub fields: BTreeMap<FieldKey, CacheValue>,
}

impl Record {
    /// Merges `other` into `self` field-by-field (new values replace old;
    /// lists and embedded objects are replaced wholesale, graphcache
    /// semantics). Returns true when anything changed.
    pub fn merge(&mut self, other: Record) -> bool {
        let mut changed = false;
        for (k, v) in other.fields {
            match self.fields.get(&k) {
                Some(existing) if *existing == v => {}
                _ => {
                    self.fields.insert(k, v);
                    changed = true;
                }
            }
        }
        changed
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
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_sorts_keys_recursively() {
        let v = json!({"b": {"z": 1, "a": [ {"y": 2, "x": 3} ]}, "a": null});
        assert_eq!(
            canonical_json(&v),
            r#"{"a":null,"b":{"a":[{"x":3,"y":2}],"z":1}}"#
        );
    }

    #[test]
    fn merge_reports_changes() {
        let mut r = Record::default();
        let mut other = Record::default();
        other
            .fields
            .insert("name".into(), CacheValue::String("A".into()));
        assert!(r.merge(other.clone()));
        assert!(!r.merge(other)); // idempotent
        let mut third = Record::default();
        third
            .fields
            .insert("name".into(), CacheValue::String("B".into()));
        assert!(r.merge(third));
    }

    #[test]
    fn entity_key_format() {
        assert_eq!(
            EntityKey::entity("GraphqlSoupDocument", &["doc-1"]).0,
            "GraphqlSoupDocument:doc-1"
        );
        assert_eq!(
            field_key("soup", Some(r#"{"input":{}}"#)),
            r#"soup({"input":{}})"#
        );
        assert_eq!(field_key("id", None), "id");
    }
}
