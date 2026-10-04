//! Paragraph content as an attributed string.
//!
//! A paragraph's runs are flattened into text plus attribute spans, the shape
//! a rich-text CRDT stores (one Loro text per paragraph, marks for formatting).
//! Every run property element is its own attribute (`r:w:b` → `<w:b/>`), so
//! two people formatting overlapping text in different ways both win.
//! Non-text run content (pictures, field characters, note references,
//! bookmarks...) is an object character, U+FFFC, whose `obj` attribute holds
//! its XML. Hyperlinks, tracked changes, content controls and the other
//! elements that wrap runs are a `wrap` attribute listing their tags.
//!
//! Positions are UTF-16 code units, the unit JavaScript strings and the CRDT
//! use, so offsets mean the same thing on both sides of the worker boundary.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

/// The object replacement character standing in for non-text content.
pub const OBJECT_CHAR: char = '\u{FFFC}';

/// Attribute keys.
pub mod key {
    /// XML of an object character's element, which belongs inside a run
    /// (pictures, field characters, note references, symbols...).
    pub const OBJ: &str = "obj";
    /// XML of an object character's element, which sits between runs
    /// (bookmarks, comment ranges, math...).
    pub const MARK: &str = "mark";
    /// JSON `[[open, close], ...]` of the elements wrapping the text, outermost first.
    pub const WRAP: &str = "wrap";
    /// Marks field instruction text (`w:instrText`).
    pub const INSTR: &str = "instr";
    /// Prefix of run property keys: `r:` + the property element's qualified name.
    pub const RUN_PROP: &str = "r:";
    /// Prefix of run element attribute keys: `ra:` + the attribute's qualified name.
    pub const RUN_ATTR: &str = "ra:";
}

/// An immutable attribute set, shared between spans.
#[derive(Clone, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Attrs(Arc<BTreeMap<Box<str>, Box<str>>>);

impl std::fmt::Debug for Attrs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map().entries(self.0.iter()).finish()
    }
}

impl Attrs {
    /// The empty set.
    pub fn empty() -> Self {
        Self::default()
    }

    /// A set from key/value pairs.
    pub fn from_pairs<K: Into<Box<str>>, V: Into<Box<str>>>(
        pairs: impl IntoIterator<Item = (K, V)>,
    ) -> Self {
        Self(Arc::new(
            pairs
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
        ))
    }

    /// One value.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(|v| &**v)
    }

    /// Whether the set holds `key`.
    pub fn has(&self, key: &str) -> bool {
        self.0.contains_key(key)
    }

    /// Whether the set is empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Every entry, in key order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.0.iter().map(|(k, v)| (&**k, &**v))
    }

    /// The set with `key` set to `value` (or removed when `None`).
    pub fn with(&self, key: &str, value: Option<&str>) -> Self {
        if self.get(key) == value {
            return self.clone();
        }
        let mut map = (*self.0).clone();
        match value {
            Some(v) => {
                map.insert(key.into(), v.into());
            }
            None => {
                map.remove(key);
            }
        }
        Self(Arc::new(map))
    }

    /// The set without the keys `drop` selects.
    pub fn without(&self, drop: impl Fn(&str) -> bool) -> Self {
        if !self.0.keys().any(|k| drop(k)) {
            return self.clone();
        }
        Self(Arc::new(
            self.0
                .iter()
                .filter(|(k, _)| !drop(k))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        ))
    }

    /// Run property entries (`r:` keys) with the prefix stripped.
    pub fn run_props(&self) -> impl Iterator<Item = (&str, &str)> {
        self.iter()
            .filter_map(|(k, v)| k.strip_prefix(key::RUN_PROP).map(|k| (k, v)))
    }

    /// The run-level object XML of an object character.
    pub fn object(&self) -> Option<&str> {
        self.get(key::OBJ)
    }

    /// The paragraph-level marker XML of an object character.
    pub fn marker(&self) -> Option<&str> {
        self.get(key::MARK)
    }

    /// Whether the character carries an object or a marker.
    pub fn is_object(&self) -> bool {
        self.has(key::OBJ) || self.has(key::MARK)
    }

    /// The wrapper stack, outermost first.
    pub fn wrappers(&self) -> Vec<Wrapper> {
        self.get(key::WRAP)
            .and_then(|w| serde_json::from_str::<Vec<(String, String)>>(w).ok())
            .unwrap_or_default()
            .into_iter()
            .map(|(open, close)| Wrapper { open, close })
            .collect()
    }

    /// Whether the text is field instruction text.
    pub fn is_instr(&self) -> bool {
        self.has(key::INSTR)
    }

    /// The formatting a character typed next to this one inherits: run
    /// properties and wrappers, without object or field-code markers.
    pub fn for_typing(&self) -> Self {
        self.without(|k| k == key::OBJ || k == key::MARK || k == key::INSTR)
    }
}

/// An element wrapping runs: its opening markup (start tag and property
/// children) and closing markup.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wrapper {
    /// Markup before the content.
    pub open: String,
    /// Markup after the content.
    pub close: String,
}

impl Wrapper {
    /// The element's qualified name.
    pub fn qname(&self) -> &str {
        let tag = self.open.trim_start_matches('<');
        let end = tag
            .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .unwrap_or(tag.len());
        &tag[..end]
    }

    /// The local name (after the prefix).
    pub fn local(&self) -> &str {
        let q = self.qname();
        q.rsplit(':').next().unwrap_or(q)
    }
}

/// Encodes a wrapper stack as the `wrap` attribute value.
pub fn encode_wrappers(stack: &[Wrapper]) -> Option<String> {
    if stack.is_empty() {
        return None;
    }
    let pairs: Vec<(&str, &str)> = stack
        .iter()
        .map(|w| (w.open.as_str(), w.close.as_str()))
        .collect();
    serde_json::to_string(&pairs).ok()
}

/// A run of text sharing one attribute set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    /// The text.
    pub text: String,
    /// Its attributes.
    pub attrs: Attrs,
}

/// Number of UTF-16 code units in `s`.
pub fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// Byte offset of UTF-16 offset `at` in `s` (clamped to the end; an offset
/// inside a surrogate pair rounds up to the next character).
pub fn byte_at(s: &str, at: usize) -> usize {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        if units >= at {
            return i;
        }
        units += c.len_utf16();
    }
    s.len()
}

/// A paragraph's content: spans with distinct neighbouring attributes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Content {
    spans: Vec<Span>,
}

/// One operation of a rich-text delta (Quill's format, as Loro reads and
/// writes it). Lengths are UTF-16 code units.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DeltaOp {
    /// Insert text with exactly these attributes.
    Insert {
        /// The text.
        insert: String,
        /// Its attributes (every one it has).
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        attributes: BTreeMap<String, serde_json::Value>,
    },
    /// Delete characters.
    Delete {
        /// How many.
        delete: usize,
    },
    /// Keep characters, changing the listed attributes (`null` removes one).
    Retain {
        /// How many.
        retain: usize,
        /// Attribute changes.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        attributes: BTreeMap<String, serde_json::Value>,
    },
}

fn attrs_to_json(attrs: &Attrs) -> BTreeMap<String, serde_json::Value> {
    attrs
        .iter()
        .map(|(k, v)| (k.to_owned(), serde_json::Value::String(v.to_owned())))
        .collect()
}

fn json_to_attr(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

impl Content {
    /// Empty content.
    pub fn new() -> Self {
        Self::default()
    }

    /// Content from spans (normalized).
    pub fn from_spans(spans: impl IntoIterator<Item = Span>) -> Self {
        let mut c = Self::new();
        for s in spans {
            c.push(&s.text, s.attrs);
        }
        c
    }

    /// Appends text with `attrs`, merging with the last span when equal.
    pub fn push(&mut self, text: &str, attrs: Attrs) {
        if text.is_empty() {
            return;
        }
        if let Some(last) = self.spans.last_mut()
            && last.attrs == attrs
        {
            last.text.push_str(text);
            return;
        }
        self.spans.push(Span {
            text: text.to_owned(),
            attrs,
        });
    }

    /// The spans.
    pub fn spans(&self) -> &[Span] {
        &self.spans
    }

    /// Length in UTF-16 code units.
    pub fn len(&self) -> usize {
        self.spans.iter().map(|s| utf16_len(&s.text)).sum()
    }

    /// Whether there is no content.
    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    /// The plain text, object characters included.
    pub fn text(&self) -> String {
        self.spans.iter().map(|s| s.text.as_str()).collect()
    }

    /// Spans with their UTF-16 start offsets.
    pub fn spans_at(&self) -> impl Iterator<Item = (usize, &Span)> {
        let mut at = 0;
        self.spans.iter().map(move |s| {
            let start = at;
            at += utf16_len(&s.text);
            (start, s)
        })
    }

    /// Attributes of the character at `pos` (`None` past the end).
    pub fn attrs_at(&self, pos: usize) -> Option<&Attrs> {
        let mut at = 0;
        for s in &self.spans {
            let len = utf16_len(&s.text);
            if pos < at + len {
                return Some(&s.attrs);
            }
            at += len;
        }
        None
    }

    /// The formatting text typed at `pos` gets: that of the character before
    /// it, or after it at the start of the paragraph.
    pub fn typing_attrs(&self, pos: usize) -> Attrs {
        let before = if pos > 0 {
            self.attrs_at(pos - 1)
        } else {
            None
        };
        // Typing after an object (a picture, a field end) takes the formatting
        // of the text around it, never the object itself.
        before
            .or_else(|| self.attrs_at(pos))
            .map(Attrs::for_typing)
            .unwrap_or_default()
    }

    /// Splits spans so that `pos` falls on a span boundary; returns the index
    /// of the first span at or after `pos`.
    fn split_at(&mut self, pos: usize) -> usize {
        let mut at = 0;
        for i in 0..self.spans.len() {
            let len = utf16_len(&self.spans[i].text);
            if pos == at {
                return i;
            }
            if pos < at + len {
                let b = byte_at(&self.spans[i].text, pos - at);
                let tail = self.spans[i].text.split_off(b);
                let attrs = self.spans[i].attrs.clone();
                self.spans.insert(i + 1, Span { text: tail, attrs });
                return i + 1;
            }
            at += len;
        }
        self.spans.len()
    }

    fn normalize(&mut self) {
        let mut out: Vec<Span> = Vec::with_capacity(self.spans.len());
        for s in self.spans.drain(..) {
            if s.text.is_empty() {
                continue;
            }
            match out.last_mut() {
                Some(last) if last.attrs == s.attrs => last.text.push_str(&s.text),
                _ => out.push(s),
            }
        }
        self.spans = out;
    }

    /// Inserts `text` with `attrs` at `pos`.
    pub fn insert(&mut self, pos: usize, text: &str, attrs: Attrs) {
        if text.is_empty() {
            return;
        }
        let i = self.split_at(pos.min(self.len()));
        self.spans.insert(
            i,
            Span {
                text: text.to_owned(),
                attrs,
            },
        );
        self.normalize();
    }

    /// Inserts other content at `pos`.
    pub fn insert_content(&mut self, pos: usize, other: &Content) {
        let i = self.split_at(pos.min(self.len()));
        for (k, s) in other.spans.iter().enumerate() {
            self.spans.insert(i + k, s.clone());
        }
        self.normalize();
    }

    /// Removes `[start, end)`.
    pub fn delete(&mut self, start: usize, end: usize) {
        if end <= start {
            return;
        }
        let a = self.split_at(start);
        let b = self.split_at(end);
        self.spans.drain(a..b);
        self.normalize();
    }

    /// A copy of `[start, end)`.
    pub fn slice(&self, start: usize, end: usize) -> Content {
        let mut copy = self.clone();
        let len = copy.len();
        copy.delete(end.min(len), len);
        copy.delete(0, start.min(end));
        copy
    }

    /// Splits off `[pos, len)` and returns it.
    pub fn split_off(&mut self, pos: usize) -> Content {
        let i = self.split_at(pos.min(self.len()));
        let tail = self.spans.split_off(i);
        Content { spans: tail }
    }

    /// Applies `f` to the attributes of every character in `[start, end)`.
    pub fn map_attrs(&mut self, start: usize, end: usize, f: impl Fn(&Attrs) -> Attrs) {
        if end <= start {
            return;
        }
        let a = self.split_at(start);
        let b = self.split_at(end);
        for s in &mut self.spans[a..b] {
            s.attrs = f(&s.attrs);
        }
        self.normalize();
    }

    /// Sets (or with `None` removes) one attribute on `[start, end)`.
    pub fn set_attr(&mut self, start: usize, end: usize, key: &str, value: Option<&str>) {
        self.map_attrs(start, end, |a| a.with(key, value));
    }

    /// The content as a delta of inserts (a fresh text's full state).
    pub fn to_delta(&self) -> Vec<DeltaOp> {
        self.spans
            .iter()
            .map(|s| DeltaOp::Insert {
                insert: s.text.clone(),
                attributes: attrs_to_json(&s.attrs),
            })
            .collect()
    }

    /// Content from a delta of inserts (retains and deletes are ignored).
    pub fn from_delta(delta: &[DeltaOp]) -> Self {
        let mut c = Content::new();
        for op in delta {
            if let DeltaOp::Insert { insert, attributes } = op {
                let attrs = Attrs::from_pairs(
                    attributes
                        .iter()
                        .filter_map(|(k, v)| json_to_attr(v).map(|v| (k.clone(), v))),
                );
                c.push(insert, attrs);
            }
        }
        c
    }

    /// Applies a delta in place.
    pub fn apply_delta(&mut self, delta: &[DeltaOp]) {
        let mut pos = 0;
        for op in delta {
            match op {
                DeltaOp::Retain { retain, attributes } => {
                    if !attributes.is_empty() {
                        let changes: Vec<(String, Option<String>)> = attributes
                            .iter()
                            .map(|(k, v)| (k.clone(), json_to_attr(v)))
                            .collect();
                        self.map_attrs(pos, pos + retain, |a| {
                            let mut a = a.clone();
                            for (k, v) in &changes {
                                a = a.with(k, v.as_deref());
                            }
                            a
                        });
                    }
                    pos += retain;
                }
                DeltaOp::Insert { insert, attributes } => {
                    let attrs = Attrs::from_pairs(
                        attributes
                            .iter()
                            .filter_map(|(k, v)| json_to_attr(v).map(|v| (k.clone(), v))),
                    );
                    self.insert(pos, insert, attrs);
                    pos += utf16_len(insert);
                }
                DeltaOp::Delete { delete } => self.delete(pos, pos + delete),
            }
        }
    }
}

/// Builds the delta that inserts `text` with `attrs` at `pos`.
pub fn insert_delta(pos: usize, text: &str, attrs: &Attrs) -> Vec<DeltaOp> {
    let mut d = Vec::new();
    if pos > 0 {
        d.push(DeltaOp::Retain {
            retain: pos,
            attributes: BTreeMap::new(),
        });
    }
    d.push(DeltaOp::Insert {
        insert: text.to_owned(),
        attributes: attrs_to_json(attrs),
    });
    d
}

/// Builds the delta that inserts `content` at `pos`.
pub fn insert_content_delta(pos: usize, content: &Content) -> Vec<DeltaOp> {
    let mut d = Vec::new();
    if pos > 0 {
        d.push(DeltaOp::Retain {
            retain: pos,
            attributes: BTreeMap::new(),
        });
    }
    d.extend(content.to_delta());
    d
}

/// Builds the delta that deletes `[start, end)`.
pub fn delete_delta(start: usize, end: usize) -> Vec<DeltaOp> {
    let mut d = Vec::new();
    if start > 0 {
        d.push(DeltaOp::Retain {
            retain: start,
            attributes: BTreeMap::new(),
        });
    }
    d.push(DeltaOp::Delete {
        delete: end - start,
    });
    d
}

/// The delta that changes attributes of `before` into those of `after`,
/// which must hold the same text.
pub fn attr_delta(before: &Content, after: &Content) -> Vec<DeltaOp> {
    // Walk both span lists in step over shared boundaries.
    let mut cuts: Vec<usize> = Vec::new();
    for (start, s) in before.spans_at() {
        cuts.push(start);
        cuts.push(start + utf16_len(&s.text));
    }
    for (start, s) in after.spans_at() {
        cuts.push(start);
        cuts.push(start + utf16_len(&s.text));
    }
    cuts.sort_unstable();
    cuts.dedup();
    let mut d: Vec<DeltaOp> = Vec::new();
    let mut pending_retain = 0usize;
    for w in cuts.windows(2) {
        let (a, b) = (w[0], w[1]);
        let old = before.attrs_at(a).cloned().unwrap_or_default();
        let new = after.attrs_at(a).cloned().unwrap_or_default();
        let mut changes = BTreeMap::new();
        for (k, v) in new.iter() {
            if old.get(k) != Some(v) {
                changes.insert(k.to_owned(), serde_json::Value::String(v.to_owned()));
            }
        }
        for (k, _) in old.iter() {
            if !new.has(k) {
                changes.insert(k.to_owned(), serde_json::Value::Null);
            }
        }
        if changes.is_empty() {
            pending_retain += b - a;
            continue;
        }
        if pending_retain > 0 {
            d.push(DeltaOp::Retain {
                retain: pending_retain,
                attributes: BTreeMap::new(),
            });
            pending_retain = 0;
        }
        match d.last_mut() {
            Some(DeltaOp::Retain { retain, attributes }) if *attributes == changes => {
                *retain += b - a;
            }
            _ => d.push(DeltaOp::Retain {
                retain: b - a,
                attributes: changes,
            }),
        }
    }
    d
}

#[cfg(test)]
mod test;
