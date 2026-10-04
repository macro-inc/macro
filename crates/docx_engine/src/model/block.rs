//! Blocks: paragraphs, tables and their rows and cells, content controls.
//!
//! A story (the body, a header, a footnote) is a tree of blocks addressed by
//! stable ids. Each block keeps its own element's attributes and property
//! elements as XML, and children are ordered by fractional position keys, so
//! the same tree maps directly onto the collaborative maps: concurrent edits
//! to different blocks never conflict, and inserting a paragraph never
//! renumbers its neighbours.

use super::content::Content;
use pptx_engine::collab::order;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

static VERSION: AtomicU64 = AtomicU64::new(1);

/// A version number no other change in this process has used, so a block's
/// (id, version) identifies its content across stories and document copies.
pub fn next_version() -> u64 {
    VERSION.fetch_add(1, Ordering::Relaxed)
}

/// Identifies a block, stable across edits, saves and peers.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct BlockId(Arc<str>);

impl Serialize for BlockId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for BlockId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Ok(BlockId(s.into()))
    }
}

impl BlockId {
    /// Wraps an id string.
    pub fn new(id: &str) -> Self {
        Self(id.into())
    }

    /// The id as a string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for BlockId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "#{}", self.0)
    }
}

impl std::fmt::Display for BlockId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// What a block is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BlockKind {
    /// `w:p`; `props` is its `w:pPr`, `content` its runs.
    #[serde(rename = "p")]
    Paragraph,
    /// `w:tbl`; `props` is `w:tblPr` and `w:tblGrid`.
    #[serde(rename = "tbl")]
    Table,
    /// `w:tr`; `props` is `w:tblPrEx` and `w:trPr`.
    #[serde(rename = "tr")]
    Row,
    /// `w:tc`; `props` is `w:tcPr`.
    #[serde(rename = "tc")]
    Cell,
    /// A block-level element wrapping blocks (`w:sdt`, `w:customXml`);
    /// `props` is JSON `[open, close]` markup around the children.
    #[serde(rename = "sdt")]
    Container,
    /// Any other block-level element, kept verbatim in `props`.
    #[serde(rename = "x")]
    Opaque,
}

impl BlockKind {
    /// The short code used in collaborative entries.
    pub fn code(self) -> &'static str {
        match self {
            BlockKind::Paragraph => "p",
            BlockKind::Table => "tbl",
            BlockKind::Row => "tr",
            BlockKind::Cell => "tc",
            BlockKind::Container => "sdt",
            BlockKind::Opaque => "x",
        }
    }

    /// Parses a short code.
    pub fn from_code(code: &str) -> Option<Self> {
        Some(match code {
            "p" => BlockKind::Paragraph,
            "tbl" => BlockKind::Table,
            "tr" => BlockKind::Row,
            "tc" => BlockKind::Cell,
            "sdt" => BlockKind::Container,
            "x" => BlockKind::Opaque,
            _ => return None,
        })
    }
}

/// One block.
#[derive(Clone, Debug)]
pub struct Block {
    /// Stable id.
    pub id: BlockId,
    /// Kind.
    pub kind: BlockKind,
    /// The containing block (`None` = the story itself).
    pub parent: Option<BlockId>,
    /// Fractional position among its siblings.
    pub order: String,
    /// Attributes of the block's element as written (with a leading space).
    pub attrs: String,
    /// Property elements (or the whole element for opaque blocks), as XML.
    pub props: String,
    /// Runs of a paragraph.
    pub content: Content,
    /// Bumped on every change; layout caches key on it.
    pub version: u64,
}

impl Block {
    /// A new block.
    pub fn new(id: BlockId, kind: BlockKind, parent: Option<BlockId>, order: String) -> Self {
        Self {
            id,
            kind,
            parent,
            order,
            attrs: String::new(),
            props: String::new(),
            content: Content::new(),
            version: 0,
        }
    }

    /// The open/close markup of a container.
    pub fn container_markup(&self) -> (String, String) {
        serde_json::from_str::<(String, String)>(&self.props).unwrap_or_default()
    }
}

/// A tree of blocks.
#[derive(Clone, Debug, Default)]
pub struct Story {
    blocks: HashMap<BlockId, Block>,
    /// Children of each parent (`None` = top level), sorted by (order, id).
    children: HashMap<Option<BlockId>, Vec<BlockId>>,
    /// Changes on every change (a [`next_version`] value).
    revision: u64,
}

static NO_CHILDREN: Vec<BlockId> = Vec::new();

impl Story {
    /// An empty story.
    pub fn new() -> Self {
        Self::default()
    }

    /// Changes on every change to the story.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Number of blocks.
    pub fn len(&self) -> usize {
        self.blocks.len()
    }

    /// Whether the story has no blocks.
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    /// A block.
    pub fn get(&self, id: &BlockId) -> Option<&Block> {
        self.blocks.get(id)
    }

    /// A block, for changing. Bumps its version.
    pub fn get_mut(&mut self, id: &BlockId) -> Option<&mut Block> {
        let version = next_version();
        self.revision = version;
        self.blocks.get_mut(id).map(|b| {
            b.version = version;
            b
        })
    }

    /// Whether the block exists.
    pub fn contains(&self, id: &BlockId) -> bool {
        self.blocks.contains_key(id)
    }

    /// Every block, in no particular order.
    pub fn blocks(&self) -> impl Iterator<Item = &Block> {
        self.blocks.values()
    }

    /// Children of `parent` (`None` = top level), in order.
    pub fn children(&self, parent: Option<&BlockId>) -> &[BlockId] {
        self.children.get(&parent.cloned()).unwrap_or(&NO_CHILDREN)
    }

    fn sort_children(&mut self, parent: Option<&BlockId>) {
        let blocks = &self.blocks;
        if let Some(list) = self.children.get_mut(&parent.cloned()) {
            list.sort_by(|a, b| {
                let (ka, kb) = (
                    blocks.get(a).map_or("", |x| x.order.as_str()),
                    blocks.get(b).map_or("", |x| x.order.as_str()),
                );
                ka.cmp(kb).then_with(|| a.cmp(b))
            });
        }
    }

    /// Adds or replaces a block, keeping its parent's children ordered.
    pub fn insert(&mut self, mut block: Block) {
        self.revision = next_version();
        block.version = self.revision;
        if let Some(old) = self.blocks.get(&block.id) {
            let old_parent = old.parent.clone();
            if old_parent != block.parent {
                if let Some(list) = self.children.get_mut(&old_parent) {
                    list.retain(|c| *c != block.id);
                }
            }
        }
        let parent = block.parent.clone();
        let id = block.id.clone();
        self.blocks.insert(id.clone(), block);
        let list = self.children.entry(parent.clone()).or_default();
        if !list.contains(&id) {
            list.push(id);
        }
        self.sort_children(parent.as_ref());
    }

    /// Changes a block's position key (and parent).
    pub fn move_block(&mut self, id: &BlockId, parent: Option<BlockId>, order: String) {
        let Some(mut block) = self.blocks.get(id).cloned() else {
            return;
        };
        block.parent = parent;
        block.order = order;
        self.insert(block);
    }

    /// Removes a block and everything inside it; returns the removed ids.
    pub fn remove(&mut self, id: &BlockId) -> Vec<BlockId> {
        let mut removed = Vec::new();
        let mut stack = vec![id.clone()];
        while let Some(at) = stack.pop() {
            if let Some(kids) = self.children.remove(&Some(at.clone())) {
                stack.extend(kids);
            }
            if let Some(b) = self.blocks.remove(&at) {
                if let Some(list) = self.children.get_mut(&b.parent) {
                    list.retain(|c| *c != at);
                }
                removed.push(at);
            }
        }
        self.revision = next_version();
        removed
    }

    /// Removes one block, keeping its children (which become orphans until
    /// re-parented or removed).
    pub fn remove_one(&mut self, id: &BlockId) -> Option<Block> {
        let b = self.blocks.remove(id)?;
        if let Some(list) = self.children.get_mut(&b.parent) {
            list.retain(|c| c != id);
        }
        self.revision = next_version();
        Some(b)
    }

    /// Visits blocks depth-first in document order.
    pub fn walk(&self, mut f: impl FnMut(&Block, usize)) {
        fn go(
            story: &Story,
            parent: Option<&BlockId>,
            depth: usize,
            f: &mut dyn FnMut(&Block, usize),
        ) {
            for id in story.children(parent) {
                if let Some(b) = story.blocks.get(id) {
                    f(b, depth);
                    go(story, Some(id), depth + 1, f);
                }
            }
        }
        go(self, None, 0, &mut f);
    }

    /// Visits a block and everything inside it, depth-first in order.
    pub fn walk_from(&self, id: &BlockId, f: &mut dyn FnMut(&Block)) {
        let Some(b) = self.blocks.get(id) else {
            return;
        };
        f(b);
        for c in self.children(Some(id)) {
            self.walk_from(c, f);
        }
    }

    /// Paragraph ids in document order (including those inside tables).
    pub fn paragraphs(&self) -> Vec<BlockId> {
        let mut out = Vec::new();
        self.walk(|b, _| {
            if b.kind == BlockKind::Paragraph {
                out.push(b.id.clone());
            }
        });
        out
    }

    /// The chain of ancestors of a block, nearest first.
    pub fn ancestors(&self, id: &BlockId) -> Vec<BlockId> {
        let mut out = Vec::new();
        let mut at = self.blocks.get(id).and_then(|b| b.parent.clone());
        while let Some(p) = at {
            at = self.blocks.get(&p).and_then(|b| b.parent.clone());
            out.push(p);
        }
        out
    }

    /// The position key for a new child of `parent` placed after `after`
    /// (`None` = first) and before the sibling that follows it.
    pub fn key_after(&self, parent: Option<&BlockId>, after: Option<&BlockId>) -> String {
        let kids = self.children(parent);
        let index = match after {
            Some(a) => kids
                .iter()
                .position(|k| k == a)
                .map_or(kids.len(), |i| i + 1),
            None => 0,
        };
        let low = index
            .checked_sub(1)
            .and_then(|i| kids.get(i))
            .and_then(|k| self.blocks.get(k))
            .map(|b| b.order.as_str());
        let high = kids
            .get(index)
            .and_then(|k| self.blocks.get(k))
            .map(|b| b.order.as_str());
        order::key_between(low, high)
    }

    /// Re-sorts every children list (after bulk changes to order keys).
    pub fn resort(&mut self) {
        let parents: Vec<Option<BlockId>> = self.children.keys().cloned().collect();
        for p in parents {
            self.sort_children(p.as_ref());
        }
    }

    /// Blocks whose parent is missing (left behind by concurrent deletes).
    pub fn orphans(&self) -> Vec<BlockId> {
        self.blocks
            .values()
            .filter(|b| {
                b.parent
                    .as_ref()
                    .is_some_and(|p| !self.blocks.contains_key(p))
            })
            .map(|b| b.id.clone())
            .collect()
    }
}

/// Generates block ids: sequential for documents opened locally, random
/// (per-peer seeded) for collaborative ones so concurrent inserts never collide.
#[derive(Debug)]
pub struct IdGen {
    next: u64,
    random: Option<Arc<pptx_engine::opc::IdSource>>,
}

impl IdGen {
    /// Sequential ids starting at 1.
    pub fn sequential() -> Self {
        Self {
            next: 1,
            random: None,
        }
    }

    /// Random ids from a seeded source.
    pub fn random(seed: u64) -> Self {
        Self {
            next: 1,
            random: Some(Arc::new(pptx_engine::opc::IdSource::new(seed))),
        }
    }

    /// Whether ids are random.
    pub fn is_random(&self) -> bool {
        self.random.is_some()
    }

    /// The random source, if any.
    pub fn source(&self) -> Option<&Arc<pptx_engine::opc::IdSource>> {
        self.random.as_ref()
    }

    /// The next id.
    pub fn next_id(&mut self) -> BlockId {
        match &self.random {
            Some(r) => BlockId::new(&radix36(r.next_in(1 << 40..1 << 52))),
            None => {
                let n = self.next;
                self.next += 1;
                BlockId::new(&radix36(n))
            }
        }
    }
}

fn radix36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Spreads `count` fresh position keys evenly.
pub fn initial_keys(count: usize) -> Vec<String> {
    order::keys_between(None, None, count)
}

#[cfg(test)]
mod test;
