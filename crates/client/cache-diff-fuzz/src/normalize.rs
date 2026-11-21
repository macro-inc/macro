//! Makes a response comparable across runs: ids the engine mints (storage and
//! Mail generations, observation instances, and SHA-256 digests of them) become
//! `#1`, `#2`, … in order of first appearance, ids that appear in the case's
//! inputs stay as they are, and the run's directory becomes `<dir>`. With
//! `source_hashes`, each distinct `sourceHash` becomes `h1`, `h2`, … in order of
//! first appearance, so two builds that encode records differently must still
//! agree on which results share a hash and when one changes.

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
    /// `sourceHash` values to their labels, when they are labelled.
    source_hashes: Option<HashMap<String, String>>,
}

/// Keys whose arrays come from hash sets, so their order means nothing.
const UNORDERED: &[&str] = &["affectedOps", "changed", "searchChangedBuckets"];

impl Normalizer {
    /// `inputs` is everything the case feeds the engine. Any id in it was made
    /// by the generator or the faker, not minted by the engine, so it is kept:
    /// a build that answers with the wrong one of those ids shows up.
    pub fn new(inputs: &str, root: &Path, source_hashes: bool) -> Self {
        let keep = id_spans(inputs)
            .map(|(start, width)| inputs[start..start + width].to_owned())
            .collect();
        Self {
            keep,
            minted: HashMap::new(),
            root: root.display().to_string(),
            frozen: false,
            source_hashes: source_hashes.then(HashMap::new),
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
                        if key == "sourceHash"
                            && let (Some(labels), Value::String(hash)) =
                                (&mut self.source_hashes, &value)
                        {
                            let next = format!("h{}", labels.len() + 1);
                            let label = labels.entry(hash.clone()).or_insert(next).clone();
                            return (key, Value::String(label));
                        }
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
        let mut out = String::with_capacity(text.len());
        let mut copied = 0;
        for (start, width) in id_spans(&text) {
            let id = &text[start..start + width];
            if self.keep.contains(id) {
                continue;
            }
            out.push_str(&text[copied..start]);
            copied = start + width;
            let next = self.minted.len() + 1;
            match self.minted.get(id) {
                Some(name) => out.push_str(name),
                None if self.frozen => out.push_str("#?"),
                None => {
                    let name = format!("#{next}");
                    out.push_str(&name);
                    self.minted.insert(id.to_owned(), name);
                }
            }
        }
        out.push_str(&text[copied..]);
        out
    }
}

/// The UUIDs and 64-digit hex runs (SHA-256 digests, such as people cursors) in
/// `text`, as `(start, width)`, each bounded by non-hex characters.
fn id_spans(text: &str) -> impl Iterator<Item = (usize, usize)> + '_ {
    let bytes = text.as_bytes();
    let mut index = 0;
    std::iter::from_fn(move || {
        while index + 36 <= bytes.len() {
            let width = if is_uuid(&bytes[index..index + 36]) {
                36
            } else if bytes
                .get(index..index + 64)
                .is_some_and(|run| run.iter().all(u8::is_ascii_hexdigit))
            {
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
                let start = index;
                index += width;
                return Some((start, width));
            }
            index += 1;
        }
        None
    })
}

fn is_uuid(bytes: &[u8]) -> bool {
    bytes.iter().enumerate().all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => *byte == b'-',
        _ => byte.is_ascii_hexdigit(),
    })
}
