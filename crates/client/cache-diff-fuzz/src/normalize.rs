//! Makes a response comparable across runs: ids the engine mints (storage and
//! Mail generations, observation instances) become `#1`, `#2`, … in order of
//! first appearance, ids the generator made stay as they are, and the run's
//! directory becomes `<dir>`.

use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;

pub struct Normalizer {
    keep: BTreeSet<String>,
    minted: HashMap<String, String>,
    root: String,
}

/// Keys whose arrays come from hash sets, so their order means nothing.
const UNORDERED: &[&str] = &["affectedOps", "changed", "searchChangedBuckets"];

impl Normalizer {
    pub fn new(keep: BTreeSet<String>, root: &Path) -> Self {
        Self {
            keep,
            minted: HashMap::new(),
            root: root.display().to_string(),
        }
    }

    pub fn value(&mut self, value: Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.text(&text)),
            Value::Array(items) => Value::Array(items.into_iter().map(|item| self.value(item)).collect()),
            Value::Object(map) => Value::Object(
                map.into_iter()
                    .map(|(key, value)| {
                        let mut value = self.value(value);
                        if UNORDERED.contains(&key.as_str())
                            && let Value::Array(items) = &mut value
                        {
                            items.sort_by_key(Value::to_string);
                        }
                        (key, value)
                    })
                    .collect(),
            ),
            other => other,
        }
    }

    pub fn text(&mut self, text: &str) -> String {
        let text = text.replace(&self.root, "<dir>");
        let bytes = text.as_bytes();
        let mut out = String::with_capacity(text.len());
        let mut index = 0;
        let mut copied = 0;
        while index + 36 <= bytes.len() {
            if is_uuid(&bytes[index..index + 36])
                && (index == 0 || !bytes[index - 1].is_ascii_hexdigit())
                && bytes.get(index + 36).is_none_or(|next| !next.is_ascii_hexdigit())
            {
                let uuid = &text[index..index + 36];
                if !self.keep.contains(uuid) {
                    out.push_str(&text[copied..index]);
                    let next = self.minted.len() + 1;
                    let name = self.minted.entry(uuid.to_owned()).or_insert_with(|| format!("#{next}"));
                    out.push_str(name);
                    index += 36;
                    copied = index;
                    continue;
                }
                index += 36;
                continue;
            }
            index += 1;
        }
        out.push_str(&text[copied..]);
        out
    }
}

fn is_uuid(bytes: &[u8]) -> bool {
    bytes.iter().enumerate().all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => *byte == b'-',
        _ => byte.is_ascii_hexdigit(),
    })
}
