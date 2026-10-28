//! Collaborative editing: a document as CRDT containers.
//!
//! Peers share a document through these containers (Loro maps in the web
//! app and on the sync service):
//!
//! | container | key | value |
//! | --- | --- | --- |
//! | `docxMeta` | `formatVersion` | [`FORMAT_VERSION`] (written by the client) |
//! | `wordParts` | part name | XML text, or `b64:` + base64; the main part is its shell, with [`Shell::BLOCKS`] where the body's blocks go; a footnotes or endnotes part is its XML without the notes, each note under `part\|id` |
//! | `wordTypes` | `default\|ext`, `override\|part` | content type |
//! | `wordRels` | `relsPart\|rId` | `<Relationship/>` element |
//! | `wordBlocks` | block id | map: `k` kind, `p` parent, `o` position key, `a` attributes, `x` properties, `t` rich text |
//!
//! Every paragraph's text is its own rich-text container whose marks are the
//! span attributes, so concurrent typing in one paragraph merges character by
//! character, and formatting different properties of the same text merges
//! too. Block fields are last-writer-wins. Ids of new blocks, parts and
//! relationships are random per peer so concurrent additions never collide.
//! Notes are shared one by one, so typing in a footnote shares that note
//! (not the whole part) and two people can edit different notes at once.

use crate::document::{Document, Shell};
use crate::edit::{BlockRecord, Change};
use crate::error::{Error, Result};
use crate::model::block::{IdGen, Story};
use crate::xml::XmlTree;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use pptx_engine::opc::{CONTENT_TYPES_PART, ContentTypes, Package, TargetMode};
use pptx_engine::zip::{WriteData, Writer};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// Version of the container layout (`docxMeta.formatVersion`).
pub const FORMAT_VERSION: u32 = 2;

/// Separates a part name from the item it scopes in composite keys.
pub const KEY_SEPARATOR: char = '|';

/// Names of the containers.
pub mod container {
    /// Format metadata (shared with the first format).
    pub const META: &str = "docxMeta";
    /// Parts by name.
    pub const PARTS: &str = "wordParts";
    /// Content types.
    pub const TYPES: &str = "wordTypes";
    /// Relationships.
    pub const RELS: &str = "wordRels";
    /// Blocks by id.
    pub const BLOCKS: &str = "wordBlocks";
}

const RELATIONSHIPS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS: &str = "http://schemas.openxmlformats.org/package/2006/content-types";

/// The whole shared state of a document.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CollabState {
    /// `wordParts`.
    pub parts: BTreeMap<String, String>,
    /// `wordTypes`.
    pub types: BTreeMap<String, String>,
    /// `wordRels`.
    pub rels: BTreeMap<String, String>,
    /// `wordBlocks`, parents before children.
    pub blocks: Vec<BlockRecord>,
}

/// Whether `name` is a relationships part.
fn is_rels_part(name: &str) -> bool {
    name.ends_with(".rels") && name.contains("_rels/")
}

fn scoped(part: &str, item: &str) -> String {
    format!("{part}{KEY_SEPARATOR}{item}")
}

fn escape(out: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
}

fn relationship_xml(r: &pptx_engine::opc::Relationship) -> String {
    let mut s = String::from("<Relationship Id=\"");
    escape(&mut s, &r.id);
    s.push_str("\" Type=\"");
    escape(&mut s, &r.rel_type);
    s.push_str("\" Target=\"");
    escape(&mut s, &r.target);
    s.push('"');
    if r.mode == TargetMode::External {
        s.push_str(" TargetMode=\"External\"");
    }
    s.push_str("/>");
    s
}

/// A part's bytes as a shared string: XML as text, anything else base64.
fn encode_part(pkg: &Package, name: &str, bytes: &[u8]) -> String {
    let xml =
        pkg.content_type(name).is_some_and(|ct| ct.ends_with("xml")) || name.ends_with(".xml");
    if xml
        && !bytes.starts_with(b"b64:")
        && let Ok(text) = std::str::from_utf8(bytes)
    {
        return text.to_owned();
    }
    format!("b64:{}", STANDARD.encode(bytes))
}

fn decode_part(value: &str) -> Vec<u8> {
    match value.strip_prefix("b64:") {
        Some(data) => STANDARD.decode(data).unwrap_or_default(),
        None => value.as_bytes().to_vec(),
    }
}

/// Content type entries of a package.
fn type_entries(types: &ContentTypes) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (ext, ct) in types.defaults() {
        out.insert(scoped("default", &ext.to_ascii_lowercase()), ct.to_owned());
    }
    for (part, ct) in types.overrides() {
        out.insert(scoped("override", part), ct.to_owned());
    }
    out
}

/// `[Content_Types].xml` from its entries.
fn content_types_xml(types: &BTreeMap<String, String>) -> String {
    let mut s = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"{CONTENT_TYPES_NS}\">"
    );
    for (key, ct) in types {
        if let Some(ext) = key.strip_prefix("default|") {
            s.push_str("<Default Extension=\"");
            escape(&mut s, ext);
            s.push_str("\" ContentType=\"");
            escape(&mut s, ct);
            s.push_str("\"/>");
        }
    }
    for (key, ct) in types {
        if let Some(part) = key.strip_prefix("override|") {
            s.push_str("<Override PartName=\"");
            escape(&mut s, part);
            s.push_str("\" ContentType=\"");
            escape(&mut s, ct);
            s.push_str("\"/>");
        }
    }
    s.push_str("</Types>");
    s
}

/// rIds sort numerically when they can (`rId2` before `rId10`).
fn rid_order(id: &str) -> (u64, &str) {
    let n = id
        .strip_prefix("rId")
        .and_then(|n| n.parse().ok())
        .unwrap_or(u64::MAX);
    (n, id)
}

/// A relationships part from its entries.
fn relationships_xml(rels: &BTreeMap<String, String>, part: &str) -> Option<String> {
    let prefix = scoped(part, "");
    let mut items: Vec<(&str, &str)> = rels
        .range::<str, _>((
            std::ops::Bound::Included(prefix.as_str()),
            std::ops::Bound::Unbounded,
        ))
        .take_while(|(k, _)| k.starts_with(&prefix))
        .map(|(k, v)| (&k[prefix.len()..], v.as_str()))
        .collect();
    if items.is_empty() {
        return None;
    }
    items.sort_by(|a, b| rid_order(a.0).cmp(&rid_order(b.0)));
    let mut s = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"{RELATIONSHIPS_NS}\">"
    );
    for (_, xml) in items {
        s.push_str(xml);
    }
    s.push_str("</Relationships>");
    Some(s)
}

/// A footnotes or endnotes part's XML split into the XML without its notes
/// and the notes by id (each as written).
fn split_notes(name: &str, xml: &[u8]) -> Option<(String, BTreeMap<i64, String>)> {
    let tree = XmlTree::parse(xml, name).ok()?;
    let root = tree.root();
    if !(tree.is_w(root, "footnotes") || tree.is_w(root, "endnotes")) {
        return None;
    }
    let src = tree.source();
    let mut skeleton = String::with_capacity(src.len() / 8);
    let mut notes = BTreeMap::new();
    let mut at = 0;
    for n in tree.children(root) {
        let is_note = tree.is_w(n, "footnote") || tree.is_w(n, "endnote");
        let id = is_note
            .then(|| tree.w_attr(n, "id").and_then(crate::xml::parse_int))
            .flatten()
            .filter(|id| !notes.contains_key(id));
        let Some(id) = id else {
            continue;
        };
        let span = tree.span(n);
        skeleton.push_str(&src[at..span.start]);
        at = span.end;
        notes.insert(id, src[span.start..span.end].to_owned());
    }
    skeleton.push_str(&src[at..]);
    Some((skeleton, notes))
}

/// A notes part's XML from its shared form: the notes go back in after
/// the root's start tag, in id order.
fn join_notes<'a>(name: &str, skeleton: &str, notes: impl Iterator<Item = &'a String>) -> String {
    let notes: String = notes.map(String::as_str).collect();
    let Ok(tree) = XmlTree::parse(skeleton.as_bytes(), name) else {
        return skeleton.to_owned();
    };
    let root = tree.root();
    let src = tree.source();
    let span = tree.span(root);
    let tag = tree.start_tag(root);
    match tag.strip_suffix("/>") {
        Some(open) => format!(
            "{}{}>{notes}</{}>{}",
            &src[..span.start],
            open.trim_end(),
            tree.qname(root),
            &src[span.end..]
        ),
        None => {
            let at = span.start + tag.len();
            format!("{}{notes}{}", &src[..at], &src[at..])
        }
    }
}

/// The note id a `wordParts` key names (`part|id`), with its part.
fn note_key(key: &str) -> Option<(&str, i64)> {
    let (part, id) = key.rsplit_once(KEY_SEPARATOR)?;
    Some((part, id.parse().ok()?))
}

/// The block records of a story, parents before children.
fn story_records(story: &Story) -> Vec<BlockRecord> {
    let mut out = Vec::with_capacity(story.len());
    story.walk(|b, _| out.push(BlockRecord::of(b)));
    // Orphans (from concurrent deletes) are not part of the document.
    out
}

impl Document {
    /// The main part's shell: its XML around the blocks, with the final
    /// section properties.
    pub fn shell_template(&self) -> String {
        self.shell.to_template()
    }

    /// The shared state of this document.
    pub fn collab_state(&self) -> Result<CollabState> {
        let mut state = CollabState::default();
        let pkg = &self.pkg;
        let names: Vec<String> = pkg.part_names().map(str::to_owned).collect();
        for name in &names {
            if name.eq_ignore_ascii_case(CONTENT_TYPES_PART) {
                continue;
            }
            if is_rels_part(name) {
                let source = rels_source(name);
                let rels = pkg.rels(&source)?;
                for r in rels.iter() {
                    state.rels.insert(scoped(name, &r.id), relationship_xml(r));
                }
                continue;
            }
            if *name == self.main {
                state.parts.insert(name.clone(), self.shell.to_template());
                continue;
            }
            let bytes = pkg.read(name)?;
            if self.is_notes_part(name)
                && let Some((skeleton, notes)) = split_notes(name, &bytes)
            {
                state.parts.insert(name.clone(), skeleton);
                for (id, xml) in notes {
                    state.parts.insert(scoped(name, &id.to_string()), xml);
                }
                continue;
            }
            state
                .parts
                .insert(name.clone(), encode_part(pkg, name, &bytes));
        }
        state.types = type_entries(pkg.content_types());
        state.blocks = story_records(&self.body);
        Ok(state)
    }

    /// Opens the document a shared state describes. `seed` makes this
    /// peer's new block ids unique.
    pub fn from_collab_state(state: &CollabState, seed: u64) -> Result<Document> {
        if state.parts.is_empty() {
            return Err(Error::Collab("the shared document is empty".into()));
        }
        let bytes = assemble(state)?;
        let mut doc = Document::open_with_ids(bytes, IdGen::random(seed))?;
        let mut story = Story::new();
        for record in &state.blocks {
            if let Some(b) = record.to_block() {
                story.insert(b);
            }
        }
        doc.body = story;
        doc.body_dirty = true;
        Ok(doc)
    }

    /// Whether a part holds the footnotes or endnotes.
    pub(crate) fn is_notes_part(&self, name: &str) -> bool {
        self.footnotes().part.as_deref() == Some(name)
            || self.endnotes().part.as_deref() == Some(name)
    }

    /// Applies changes to the flat maps made by other peers (parts,
    /// relationships, content types), reloading what they affect. Returns
    /// whether the shared parts (styles, numbering...) were reloaded.
    pub fn apply_entries(&mut self, changes: &[(String, String, Option<String>)]) -> Result<bool> {
        if changes.is_empty() {
            return Ok(false);
        }
        let mut links = self.link_entries()?;
        // Whole parts, and notes by part, as the changes leave them.
        let mut parts: BTreeMap<String, Option<String>> = BTreeMap::new();
        let mut notes: BTreeMap<String, BTreeMap<i64, Option<String>>> = BTreeMap::new();
        let mut touched: BTreeSet<String> = BTreeSet::new();
        let mut types_changed = false;
        for (container, key, value) in changes {
            match container.as_str() {
                container::PARTS => match note_key(key) {
                    Some((part, id)) => {
                        notes
                            .entry(part.to_owned())
                            .or_default()
                            .insert(id, value.clone());
                        touched.insert(part.to_owned());
                    }
                    None => {
                        parts.insert(key.clone(), value.clone());
                        touched.insert(key.clone());
                    }
                },
                container::RELS => {
                    match value {
                        Some(v) => links.rels.insert(key.clone(), v.clone()),
                        None => links.rels.remove(key),
                    };
                    if let Some((part, _)) = key.rsplit_once(KEY_SEPARATOR) {
                        touched.insert(part.to_owned());
                    }
                }
                container::TYPES => {
                    match value {
                        Some(v) => links.types.insert(key.clone(), v.clone()),
                        None => links.types.remove(key),
                    };
                    types_changed = true;
                }
                _ => {}
            }
        }
        for name in &touched {
            if is_rels_part(name) {
                match relationships_xml(&links.rels, name) {
                    Some(xml) => self.pkg.write(name, xml.into_bytes(), None),
                    None => self.pkg.delete(name),
                }
                continue;
            }
            if *name == self.main {
                if let Some(Some(template)) = parts.get(name)
                    && let Some(shell) = Shell::from_template(template)
                {
                    self.shell = shell;
                    self.body_dirty = true;
                }
                continue;
            }
            let note_changes = notes.get(name);
            if note_changes.is_some() || self.is_notes_part(name) {
                // The notes part as it is, with the changes on top.
                let current = self.pkg.read(name).ok().and_then(|b| split_notes(name, &b));
                let (mut skeleton, mut by_id) = current.unwrap_or_default();
                match parts.get(name) {
                    Some(None) => {
                        self.pkg.delete(name);
                        continue;
                    }
                    Some(Some(value)) => {
                        let bytes = decode_part(value);
                        match split_notes(name, &bytes) {
                            // A whole part (with its notes) replaces them all.
                            Some((s, n)) if !n.is_empty() => (skeleton, by_id) = (s, n),
                            Some((s, _)) => skeleton = s,
                            None => {
                                self.pkg.write(name, bytes, None);
                                continue;
                            }
                        }
                    }
                    None => {}
                }
                for (id, xml) in note_changes.into_iter().flatten() {
                    match xml {
                        Some(x) => by_id.insert(*id, x.clone()),
                        None => by_id.remove(id),
                    };
                }
                if skeleton.is_empty() {
                    continue;
                }
                let xml = join_notes(name, &skeleton, by_id.values());
                self.pkg.write(name, xml.into_bytes(), None);
                continue;
            }
            match parts.get(name) {
                Some(Some(v)) => self.pkg.write(name, decode_part(v), None),
                Some(None) => self.pkg.delete(name),
                None => {}
            }
        }
        if types_changed {
            let types = ContentTypes::parse(content_types_xml(&links.types).as_bytes())?;
            self.pkg.set_content_types(types);
        }
        let main_rels = pptx_engine::opc::rels_part_name(&self.main);
        if touched.contains(&main_rels) {
            self.main_rels = std::sync::Arc::new(self.pkg.rels(&self.main)?);
        }
        let reload = touched.iter().any(|n| *n != self.main);
        if reload {
            self.load_parts()?;
        }
        Ok(reload)
    }

    /// Identities of every part, for detecting which ones an edit changed.
    pub(crate) fn part_identities(&self) -> HashMap<String, (bool, usize)> {
        self.pkg
            .part_names()
            .filter_map(|n| Some((n.to_owned(), self.pkg.part_identity(n)?)))
            .collect()
    }

    /// Relationship and content-type entries as they are.
    pub(crate) fn link_entries(&self) -> Result<Links> {
        let mut rels = BTreeMap::new();
        for name in self.pkg.part_names() {
            if !is_rels_part(name) {
                continue;
            }
            for r in self.pkg.rels(&rels_source(name))?.iter() {
                rels.insert(scoped(name, &r.id), relationship_xml(r));
            }
        }
        Ok(Links {
            rels,
            types: type_entries(self.pkg.content_types()),
        })
    }

    /// Flat-map changes since a [`Snapshot`] of the package.
    pub(crate) fn entry_changes(&self, before: &Snapshot) -> Result<Vec<Change>> {
        let mut out = Vec::new();
        let now = self.part_identities();
        let mut names: BTreeSet<&String> = now.keys().collect();
        names.extend(before.identities.keys());
        let mut links_changed = false;
        for name in names {
            if before.identities.get(name) == now.get(name) {
                continue;
            }
            links_changed = true;
            if name.eq_ignore_ascii_case(CONTENT_TYPES_PART)
                || *name == self.main
                || is_rels_part(name)
            {
                continue;
            }
            if let Some(notes) = [self.footnotes(), self.endnotes()]
                .into_iter()
                .find(|n| n.part.as_deref() == Some(name.as_str()))
                .filter(|n| !n.rewritten && !n.edited.is_empty())
            {
                // The notes edited in place: only those.
                for &id in &notes.edited {
                    out.push(Change::Entry {
                        container: container::PARTS.to_owned(),
                        key: scoped(name, &id.to_string()),
                        value: notes.note_xml(id),
                    });
                }
                continue;
            }
            if self.is_notes_part(name)
                && let Some((skeleton, notes)) =
                    self.pkg.read(name).ok().and_then(|b| split_notes(name, &b))
            {
                // Only the notes that changed.
                let (old_skeleton, old_notes) = before
                    .pkg
                    .read(name)
                    .ok()
                    .and_then(|b| split_notes(name, &b))
                    .unwrap_or_default();
                let entry = |key: String, value: Option<String>| Change::Entry {
                    container: container::PARTS.to_owned(),
                    key,
                    value,
                };
                if skeleton != old_skeleton {
                    out.push(entry(name.clone(), Some(skeleton)));
                }
                for (id, xml) in &notes {
                    if old_notes.get(id) != Some(xml) {
                        out.push(entry(scoped(name, &id.to_string()), Some(xml.clone())));
                    }
                }
                for id in old_notes.keys() {
                    if !notes.contains_key(id) {
                        out.push(entry(scoped(name, &id.to_string()), None));
                    }
                }
                continue;
            }
            let value = if self.pkg.has_part(name) {
                let bytes = self.pkg.read(name)?;
                Some(encode_part(&self.pkg, name, &bytes))
            } else {
                None
            };
            out.push(Change::Entry {
                container: container::PARTS.to_owned(),
                key: name.clone(),
                value,
            });
        }
        let shell = self.shell.to_template();
        if shell != before.shell {
            out.push(Change::Entry {
                container: container::PARTS.to_owned(),
                key: self.main.clone(),
                value: Some(shell),
            });
        }
        if links_changed {
            let links = self.link_entries()?;
            let old = before.links()?;
            for (container, new, old) in [
                (container::RELS, &links.rels, &old.rels),
                (container::TYPES, &links.types, &old.types),
            ] {
                for (k, v) in new {
                    if old.get(k) != Some(v) {
                        out.push(Change::Entry {
                            container: container.to_owned(),
                            key: k.clone(),
                            value: Some(v.clone()),
                        });
                    }
                }
                for k in old.keys() {
                    if !new.contains_key(k) {
                        out.push(Change::Entry {
                            container: container.to_owned(),
                            key: k.clone(),
                            value: None,
                        });
                    }
                }
            }
        }
        Ok(out)
    }

    /// The package's state before an edit, to find the parts it changes.
    /// It also starts noting which footnotes and endnotes the edit changes.
    pub(crate) fn snapshot(&mut self) -> Snapshot {
        for endnote in [false, true] {
            let notes = self.notes_of_mut(endnote);
            notes.edited.clear();
            notes.rewritten = false;
        }
        Snapshot {
            identities: self.part_identities(),
            shell: self.shell.to_template(),
            pkg: self.pkg.clone(),
        }
    }
}

/// Relationship and content-type entries.
#[derive(Clone, Debug, Default)]
pub(crate) struct Links {
    pub rels: BTreeMap<String, String>,
    pub types: BTreeMap<String, String>,
}

/// A package's state before an edit.
pub(crate) struct Snapshot {
    identities: HashMap<String, (bool, usize)>,
    shell: String,
    /// Cheap to clone: parts are shared until written.
    pkg: Package,
}

impl Snapshot {
    fn links(&self) -> Result<Links> {
        let mut rels = BTreeMap::new();
        for name in self.pkg.part_names() {
            if !is_rels_part(name) {
                continue;
            }
            for r in self.pkg.rels(&rels_source(name))?.iter() {
                rels.insert(scoped(name, &r.id), relationship_xml(r));
            }
        }
        Ok(Links {
            rels,
            types: type_entries(self.pkg.content_types()),
        })
    }
}

/// The part a relationships part belongs to (`/` for the package).
fn rels_source(rels_part: &str) -> String {
    let Some((dir, file)) = rels_part.rsplit_once("_rels/") else {
        return "/".to_owned();
    };
    let dir = dir.trim_end_matches('/');
    let file = file.strip_suffix(".rels").unwrap_or(file);
    if dir.is_empty() && file.is_empty() {
        "/".to_owned()
    } else {
        format!("{dir}/{file}")
    }
}

/// Builds a package from shared state, with an empty body (the blocks are
/// read from their records directly).
fn assemble(state: &CollabState) -> Result<Vec<u8>> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    files.push((
        CONTENT_TYPES_PART.trim_start_matches('/').to_owned(),
        content_types_xml(&state.types).into_bytes(),
    ));
    let mut rels_parts: BTreeSet<String> = BTreeSet::new();
    for key in state.rels.keys() {
        if let Some((part, _)) = key.rsplit_once(KEY_SEPARATOR) {
            rels_parts.insert(part.to_owned());
        }
    }
    for part in &rels_parts {
        if let Some(xml) = relationships_xml(&state.rels, part) {
            files.push((part.trim_start_matches('/').to_owned(), xml.into_bytes()));
        }
    }
    // Notes by part, in id order.
    let mut notes: BTreeMap<&str, BTreeMap<i64, &String>> = BTreeMap::new();
    for (key, value) in &state.parts {
        if let Some((part, id)) = note_key(key) {
            notes.entry(part).or_default().insert(id, value);
        }
    }
    for (name, value) in &state.parts {
        if note_key(name).is_some() {
            continue;
        }
        let bytes = match value.split_once(Shell::BLOCKS) {
            // The main part's shell: an empty body for now.
            Some((head, tail)) if !value.starts_with("b64:") => {
                format!("{head}{tail}").into_bytes()
            }
            _ => match notes.get(name.as_str()) {
                Some(by_id) => join_notes(name, value, by_id.values().copied()).into_bytes(),
                None => decode_part(value),
            },
        };
        files.push((name.trim_start_matches('/').to_owned(), bytes));
    }
    let mut w = Writer::new();
    for (name, data) in &files {
        w.add(
            name,
            WriteData::Fresh {
                data,
                compress: false,
            },
        )?;
    }
    Ok(w.finish()?)
}

#[cfg(test)]
mod test;
mod v1;

pub use v1::{V1_PLACEHOLDER, V1State};
