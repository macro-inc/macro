//! Collaborative editing: a presentation as flat CRDT maps.
//!
//! Peers share a presentation as string maps (Loro containers in the web app
//! and on the sync service). Each entry is a unit that two people rarely edit
//! at once, so concurrent edits to different entries merge, and edits to the
//! same entry resolve last-writer-wins:
//!
//! | container | key | value |
//! | --- | --- | --- |
//! | `pptxMeta` | `format` | format version |
//! | `pptxParts` | part name | XML text, or `b64:` + base64; a slide or the presentation part without its shapes or slide list |
//! | `pptxTypes` | `default\|ext`, `override\|part` | content type |
//! | `pptxRels` | `relsPart\|rId` | `<Relationship/>` element |
//! | `pptxSlides`, `pptxSlideOrder` | slide id | rId, position key |
//! | `pptxShapes`, `pptxShapeOrder` | `slidePart\|shape id` | shape XML, position key |
//!
//! A collaborative [`Presentation`] keeps a mirror of the maps. After local
//! edits, [`Presentation::collab_changes`] reports the entries to write; remote
//! changes come in through [`Presentation::apply_collab_changes`]. New parts,
//! relationships, slides and shapes get random names and ids so concurrent
//! additions never collide (see [`crate::opc::IdSource`]).

mod assemble;
mod decompose;
pub mod order;

use crate::edit::EditResult;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::opc::{CONTENT_TYPES_PART, ContentTypes, IdSource};
use decompose::scoped;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

/// Version of the entry layout, stored in `pptxMeta.format`.
pub const FORMAT_VERSION: u32 = 1;

/// Separates a part name from the item it scopes in composite keys.
pub const KEY_SEPARATOR: char = '|';

/// Names of the maps that hold a collaborative presentation.
pub mod container {
    /// Format metadata.
    pub const META: &str = "pptxMeta";
    /// Parts by name (slides and the presentation part as frames).
    pub const PARTS: &str = "pptxParts";
    /// Content types (`default|ext`, `override|part`).
    pub const TYPES: &str = "pptxTypes";
    /// Relationships (`relsPart|rId`).
    pub const RELS: &str = "pptxRels";
    /// Slide id → relationship id from the presentation part.
    pub const SLIDES: &str = "pptxSlides";
    /// Slide id → position key.
    pub const SLIDE_ORDER: &str = "pptxSlideOrder";
    /// `slidePart|shape key` → shape XML.
    pub const SHAPES: &str = "pptxShapes";
    /// `slidePart|shape key` → position key (z-order).
    pub const SHAPE_ORDER: &str = "pptxShapeOrder";
    /// Every container.
    pub const ALL: [&str; 8] = [
        META,
        PARTS,
        TYPES,
        RELS,
        SLIDES,
        SLIDE_ORDER,
        SHAPES,
        SHAPE_ORDER,
    ];
}

/// One entry written (`value`) or deleted (`None`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryChange {
    /// The map.
    pub container: String,
    /// The key within it.
    pub key: String,
    /// The new value; absent or null deletes the entry.
    #[serde(default)]
    pub value: Option<String>,
}

/// A collaborative presentation's maps: container → key → value.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Entries(pub BTreeMap<String, BTreeMap<String, String>>);

static EMPTY: BTreeMap<String, String> = BTreeMap::new();

impl Entries {
    /// The entries a list of changes leaves when applied to nothing.
    pub fn from_changes(changes: &[EntryChange]) -> Self {
        let mut entries = Self::default();
        entries.apply(changes);
        entries
    }

    /// One map (empty when absent).
    pub fn map(&self, container: &str) -> &BTreeMap<String, String> {
        self.0.get(container).unwrap_or(&EMPTY)
    }

    /// One value.
    pub fn get(&self, container: &str, key: &str) -> Option<&str> {
        self.0.get(container)?.get(key).map(String::as_str)
    }

    /// Keys of one map.
    pub fn keys(&self, container: &str) -> impl Iterator<Item = &str> {
        self.map(container).keys().map(String::as_str)
    }

    /// Entries of one map whose key starts with `prefix`.
    pub fn prefixed<'a>(
        &'a self,
        container: &str,
        prefix: &'a str,
    ) -> impl Iterator<Item = (&'a str, &'a str)> + 'a {
        self.map(container)
            .range::<str, _>((
                std::ops::Bound::Included(prefix),
                std::ops::Bound::Unbounded,
            ))
            .take_while(move |(k, _)| k.starts_with(prefix))
            .map(|(k, v)| (k.as_str(), v.as_str()))
    }

    /// Writes or deletes one entry.
    pub fn set(&mut self, container: &str, key: &str, value: Option<String>) {
        match value {
            Some(value) => {
                self.0
                    .entry(container.to_owned())
                    .or_default()
                    .insert(key.to_owned(), value);
            }
            None => {
                if let Some(map) = self.0.get_mut(container) {
                    map.remove(key);
                }
            }
        }
    }

    /// Applies changes in order.
    pub fn apply(&mut self, changes: &[EntryChange]) {
        for c in changes {
            self.set(&c.container, &c.key, c.value.clone());
        }
    }

    /// Whether the entries hold a presentation (a peer has seeded them).
    pub fn is_seeded(&self) -> bool {
        self.get(container::META, "format").is_some()
    }
}

/// The CRDT state a collaborative presentation reflects.
#[derive(Clone, Debug, Default)]
pub(crate) struct Mirror {
    entries: Entries,
    /// Part identities at the last exchange with the maps.
    synced: HashMap<String, (bool, usize)>,
}

/// Collects changes that move the mirror to a new state.
struct Diff<'a> {
    entries: &'a Entries,
    changes: Vec<EntryChange>,
}

impl Diff<'_> {
    fn set(&mut self, container: &str, key: &str, value: Option<String>) {
        if self.entries.get(container, key) != value.as_deref() {
            self.changes.push(EntryChange {
                container: container.to_owned(),
                key: key.to_owned(),
                value,
            });
        }
    }

    /// Makes the keys under `prefix` exactly `items` (in any order).
    fn replace_scope(&mut self, container: &str, prefix: &str, items: &[(String, String)]) {
        let keep: BTreeSet<String> = items.iter().map(|(k, _)| scoped(prefix, k)).collect();
        let stale: Vec<String> = self
            .entries
            .prefixed(container, &scoped(prefix, ""))
            .map(|(k, _)| k.to_owned())
            .filter(|k| !keep.contains(k))
            .collect();
        for key in stale {
            self.set(container, &key, None);
        }
        for (item, value) in items {
            self.set(container, &scoped(prefix, item), Some(value.clone()));
        }
    }

    /// Position keys so `order` reads back in this order, reusing keys.
    fn order(&mut self, container: &str, prefix: Option<&str>, order: &[String]) {
        let full = |item: &str| prefix.map_or_else(|| item.to_owned(), |p| scoped(p, item));
        let scope = prefix.map(|p| scoped(p, "")).unwrap_or_default();
        let existing: BTreeMap<String, String> = self
            .entries
            .prefixed(container, &scope)
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect();
        let wanted: Vec<String> = order.iter().map(|item| full(item)).collect();
        let keep: BTreeSet<&String> = wanted.iter().collect();
        let stale: Vec<String> = existing
            .keys()
            .filter(|k| !keep.contains(k))
            .cloned()
            .collect();
        for key in stale {
            self.set(container, &key, None);
        }
        for (key, position) in order::reorder_keys(&existing, &wanted) {
            self.set(container, &key, Some(position));
        }
    }

    /// Removes every entry of a deleted part.
    fn remove_part(&mut self, name: &str, main: &str) {
        self.set(container::PARTS, name, None);
        let prefix = scoped(name, "");
        for c in [container::RELS, container::SHAPES, container::SHAPE_ORDER] {
            let stale: Vec<String> = self
                .entries
                .prefixed(c, &prefix)
                .map(|(k, _)| k.to_owned())
                .collect();
            for key in stale {
                self.set(c, &key, None);
            }
        }
        if name == main {
            for c in [container::SLIDES, container::SLIDE_ORDER] {
                let stale: Vec<String> = self.entries.keys(c).map(str::to_owned).collect();
                for key in stale {
                    self.set(c, &key, None);
                }
            }
        }
    }
}

impl Presentation {
    /// Starts collaborative editing of an opened file: from now on new parts
    /// and ids are random (seeded with `seed`, unique per peer), and the
    /// first [`Presentation::collab_changes`] reports every entry, which seeds
    /// the shared maps.
    pub fn enable_collab(&mut self, seed: u64) {
        self.use_random_ids(seed);
        self.collab = Some(Arc::new(Mirror::default()));
    }

    fn use_random_ids(&mut self, seed: u64) {
        self.flush();
        self.pkg.use_random_ids(Arc::new(IdSource::new(seed)));
        // Relationships parsed earlier would still number new ids sequentially.
        self.rels.clear();
    }

    /// Opens the presentation the shared maps describe.
    pub fn from_entries(entries: Entries, seed: u64) -> Result<Self> {
        if !entries.is_seeded() {
            return Err(Error::InvalidEdit(
                "the shared presentation is empty".into(),
            ));
        }
        let mut pres = Presentation::open(assemble::package(&entries)?)?;
        pres.use_random_ids(seed);
        let synced = pres.identities();
        pres.collab = Some(Arc::new(Mirror { entries, synced }));
        Ok(pres)
    }

    /// Whether this presentation takes part in collaborative editing.
    pub fn is_collaborative(&self) -> bool {
        self.collab.is_some()
    }

    /// The shared maps as this presentation last exchanged them.
    pub fn collab_entries(&self) -> Option<&Entries> {
        self.collab.as_ref().map(|m| &m.entries)
    }

    fn identities(&self) -> HashMap<String, (bool, usize)> {
        self.pkg
            .part_names()
            .filter(|n| !n.eq_ignore_ascii_case(CONTENT_TYPES_PART))
            .filter_map(|n| Some((n.to_owned(), self.pkg.part_identity(n)?)))
            .collect()
    }

    /// The entry changes that bring the shared maps up to date with local
    /// edits since the last call (every entry on the first call after
    /// [`Presentation::enable_collab`]).
    pub fn collab_changes(&mut self) -> Result<Vec<EntryChange>> {
        let Some(mirror) = self.collab.clone() else {
            return Err(Error::InvalidEdit(
                "not a collaborative presentation".into(),
            ));
        };
        self.flush();
        let main = self.main_part.clone();
        let current = self.identities();
        let mut diff = Diff {
            entries: &mirror.entries,
            changes: Vec::new(),
        };
        if !mirror.entries.is_seeded() {
            diff.set(container::META, "format", Some(FORMAT_VERSION.to_string()));
        }
        let mut names: Vec<&String> = current.keys().collect();
        names.sort();
        for name in names {
            if mirror.synced.get(name) == current.get(name) {
                continue;
            }
            let parts = decompose::decompose(self, name)?;
            if let Some(value) = parts.part {
                diff.set(container::PARTS, name, Some(value));
            }
            if let Some(rels) = parts.rels {
                diff.replace_scope(container::RELS, name, &rels);
            }
            if let Some(shapes) = parts.shapes {
                diff.replace_scope(container::SHAPES, name, &shapes);
                let order: Vec<String> = shapes.into_iter().map(|(k, _)| k).collect();
                diff.order(container::SHAPE_ORDER, Some(name), &order);
            }
            if let Some(slides) = parts.slides {
                let refs: BTreeMap<&str, &str> = slides
                    .iter()
                    .map(|(id, rid)| (id.as_str(), rid.as_str()))
                    .collect();
                let stale: Vec<String> = mirror
                    .entries
                    .keys(container::SLIDES)
                    .filter(|id| !refs.contains_key(id))
                    .map(str::to_owned)
                    .collect();
                for id in stale {
                    diff.set(container::SLIDES, &id, None);
                }
                for (id, rid) in &refs {
                    diff.set(container::SLIDES, id, Some((*rid).to_owned()));
                }
                let order: Vec<String> = slides.into_iter().map(|(id, _)| id).collect();
                diff.order(container::SLIDE_ORDER, None, &order);
            }
        }
        for name in mirror.synced.keys() {
            if !current.contains_key(name) {
                diff.remove_part(name, &main);
            }
        }
        let types = decompose::content_types(&self.pkg);
        let wanted: BTreeMap<&str, &str> = types
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let stale: Vec<String> = mirror
            .entries
            .keys(container::TYPES)
            .filter(|k| !wanted.contains_key(k))
            .map(str::to_owned)
            .collect();
        for key in stale {
            diff.set(container::TYPES, &key, None);
        }
        for (key, ct) in wanted {
            diff.set(container::TYPES, key, Some(ct.to_owned()));
        }

        let changes = diff.changes;
        let mut next = (*mirror).clone();
        next.entries.apply(&changes);
        next.synced = current;
        self.collab = Some(Arc::new(next));
        Ok(changes)
    }

    /// Applies entry changes made by other peers (or by undo/redo of the
    /// shared maps), rebuilding the parts they touch.
    pub fn apply_collab_changes(&mut self, changes: &[EntryChange]) -> Result<EditResult> {
        let Some(mirror) = self.collab.clone() else {
            return Err(Error::InvalidEdit(
                "not a collaborative presentation".into(),
            ));
        };
        self.flush();
        let before = self.clone();
        let mut next = (*mirror).clone();
        next.entries.apply(changes);
        let main = assemble::main_part(&next.entries).unwrap_or_else(|| self.main_part.clone());
        let mut affected = BTreeSet::new();
        let mut types_changed = false;
        for c in changes {
            match assemble::affected_part(&c.container, &c.key, &main) {
                Some(part) => {
                    affected.insert(part);
                }
                None => types_changed |= c.container == container::TYPES,
            }
        }
        for name in &affected {
            match assemble::part(&next.entries, name, Some(&main))? {
                Some(bytes) => self.pkg.write(name, bytes, None),
                None => self.pkg.delete(name),
            }
        }
        if types_changed || !affected.is_empty() {
            let types = ContentTypes::parse(&assemble::content_types(&next.entries))?;
            self.pkg.set_content_types(types);
        }
        for name in &affected {
            self.forget(name);
            if let Some(source) = assemble::source_of(name) {
                self.forget(&source);
            }
        }
        self.reload_structure()?;
        let current = self.identities();
        for name in &affected {
            match current.get(name) {
                Some(identity) => next.synced.insert(name.clone(), *identity),
                None => next.synced.remove(name),
            };
        }
        self.collab = Some(Arc::new(next));
        Ok(crate::edit::diff(&before, self))
    }
}

#[cfg(test)]
mod test;
