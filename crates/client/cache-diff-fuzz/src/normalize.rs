//! Makes a response comparable across runs: ids the engine mints (storage and
//! Mail generations, observation instances, and SHA-256 digests of them) become
//! `#1`, `#2`, … in order of first appearance, ids the generator made stay as
//! they are, and the run's directory becomes `<dir>`.

use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;

pub struct Normalizer {
    keep: BTreeSet<String>,
    minted: HashMap<String, String>,
    root: String,
    /// After the responses: ids first seen now get no number, since the order
    /// they are seen in (table rows) is not the order they were made in.
    frozen: bool,
}

/// Keys whose arrays come from hash sets, so their order means nothing.
const UNORDERED: &[&str] = &["affectedOps", "changed", "searchChangedBuckets"];

impl Normalizer {
    pub fn new(keep: BTreeSet<String>, root: &Path) -> Self {
        Self {
            keep,
            minted: HashMap::new(),
            root: root.display().to_string(),
            frozen: false,
        }
    }

    pub fn freeze(&mut self) {
        self.frozen = true;
    }

    pub fn value(&mut self, value: Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.text(&text)),
            Value::Array(items) => {
                Value::Array(items.into_iter().map(|item| self.value(item)).collect())
            }
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
            let width = if is_uuid(&bytes[index..index + 36]) {
                36
            } else if bytes
                .get(index..index + 64)
                .is_some_and(|run| run.iter().all(u8::is_ascii_hexdigit))
            {
                // A SHA-256 the engine derives from ids it minted (people cursors).
                64
            } else {
                0
            };
            if width > 0
                && (index == 0 || !bytes[index - 1].is_ascii_hexdigit())
                && bytes
                    .get(index + width)
                    .is_none_or(|next| !next.is_ascii_hexdigit())
            {
                let uuid = &text[index..index + width];
                if !self.keep.contains(uuid) {
                    out.push_str(&text[copied..index]);
                    let next = self.minted.len() + 1;
                    match self.minted.get(uuid) {
                        Some(name) => out.push_str(name),
                        None if self.frozen => out.push_str("#?"),
                        None => {
                            let name = format!("#{next}");
                            out.push_str(&name);
                            self.minted.insert(uuid.to_owned(), name);
                        }
                    }
                    index += width;
                    copied = index;
                    continue;
                }
                index += width;
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
