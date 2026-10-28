//! Transactions: every change to the body goes through one, which keeps the
//! blocks as they were before it first touched them. Comparing those with
//! the blocks afterwards yields the collaborative changes (text deltas,
//! changed fields, new and removed blocks) and the undo record.

use crate::document::{Document, StoryTarget};
use crate::model::block::{Block, BlockId, BlockKind, Story};
use crate::model::content::{Content, DeltaOp, attr_delta};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// A block as the collaborative maps store it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BlockRecord {
    /// Block id.
    pub id: BlockId,
    /// Kind code (`p`, `tbl`, `tr`, `tc`, `sdt`, `x`).
    pub k: String,
    /// Parent block id (empty at the top level).
    pub p: String,
    /// Position key among siblings.
    pub o: String,
    /// The element's attributes as written.
    pub a: String,
    /// Property elements (or the whole element for opaque blocks).
    pub x: String,
    /// Paragraph text as a delta of inserts (paragraphs only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<Vec<DeltaOp>>,
}

impl BlockRecord {
    /// The record of a block.
    pub fn of(b: &Block) -> Self {
        Self {
            id: b.id.clone(),
            k: b.kind.code().to_owned(),
            p: b.parent
                .as_ref()
                .map_or_else(String::new, |p| p.as_str().to_owned()),
            o: b.order.clone(),
            a: b.attrs.clone(),
            x: b.props.clone(),
            t: (b.kind == BlockKind::Paragraph).then(|| b.content.to_delta()),
        }
    }

    /// The block a record describes (`None` for an unknown kind).
    pub fn to_block(&self) -> Option<Block> {
        let kind = BlockKind::from_code(&self.k)?;
        let parent = (!self.p.is_empty()).then(|| BlockId::new(&self.p));
        let mut b = Block::new(self.id.clone(), kind, parent, self.o.clone());
        b.attrs = self.a.clone();
        b.props = self.x.clone();
        if kind == BlockKind::Paragraph {
            b.content = self
                .t
                .as_deref()
                .map(Content::from_delta)
                .unwrap_or_default();
        }
        Some(b)
    }
}

/// One change to the collaborative state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Change {
    /// A new block, or one replaced wholesale.
    Block {
        /// The block.
        block: BlockRecord,
    },
    /// Fields of an existing block changed (`p`, `o`, `a`, `x`).
    Fields {
        /// Block id.
        id: BlockId,
        /// New values.
        fields: BTreeMap<String, String>,
    },
    /// An existing paragraph's text changed.
    Text {
        /// Block id.
        id: BlockId,
        /// The change, as a rich-text delta.
        delta: Vec<DeltaOp>,
    },
    /// A block was removed.
    Remove {
        /// Block id.
        id: BlockId,
    },
    /// An entry of one of the flat maps (parts, relationships, content types).
    Entry {
        /// The map.
        container: String,
        /// The key.
        key: String,
        /// The new value (`None` deletes the entry).
        value: Option<String>,
    },
}

/// The delta that turns `before` into `after`: shared text at both ends is
/// kept (with attribute changes), the middle is replaced.
pub fn content_delta(before: &Content, after: &Content) -> Vec<DeltaOp> {
    let a: Vec<char> = before.text().chars().collect();
    let b: Vec<char> = after.text().chars().collect();
    let mut prefix = 0;
    while prefix < a.len() && prefix < b.len() && a[prefix] == b[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < a.len() - prefix
        && suffix < b.len() - prefix
        && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let units = |cs: &[char]| cs.iter().map(|c| c.len_utf16()).sum::<usize>();
    let p16 = units(&a[..prefix]);
    let a_mid = units(&a[prefix..a.len() - suffix]);
    let b_mid = units(&b[prefix..b.len() - suffix]);
    let a_len = before.len();
    let b_len = after.len();
    let mut out: Vec<DeltaOp> = Vec::new();
    let push = |op: DeltaOp, out: &mut Vec<DeltaOp>| match (out.last_mut(), op) {
        (
            Some(DeltaOp::Retain {
                retain: r,
                attributes: ra,
            }),
            DeltaOp::Retain { retain, attributes },
        ) if *ra == attributes => *r += retain,
        (_, op) => out.push(op),
    };
    // Attribute changes over the shared prefix.
    let head = attr_delta(&before.slice(0, p16), &after.slice(0, p16));
    let mut covered = 0;
    for op in head {
        if let DeltaOp::Retain { retain, .. } = &op {
            covered += retain;
        }
        push(op, &mut out);
    }
    if covered < p16 {
        push(
            DeltaOp::Retain {
                retain: p16 - covered,
                attributes: BTreeMap::new(),
            },
            &mut out,
        );
    }
    if a_mid > 0 {
        push(DeltaOp::Delete { delete: a_mid }, &mut out);
    }
    if b_mid > 0 {
        for op in after.slice(p16, p16 + b_mid).to_delta() {
            push(op, &mut out);
        }
    }
    let tail = attr_delta(
        &before.slice(p16 + a_mid, a_len),
        &after.slice(p16 + b_mid, b_len),
    );
    for op in tail {
        push(op, &mut out);
    }
    // Trailing plain retains say nothing.
    while matches!(out.last(), Some(DeltaOp::Retain { attributes, .. }) if attributes.is_empty()) {
        out.pop();
    }
    debug_assert_eq!(
        {
            let mut c = before.clone();
            c.apply_delta(&out);
            c
        },
        *after
    );
    out
}

/// Changes that turn block `before` into `after` (both present).
fn block_changes(before: &Block, after: &Block, out: &mut Vec<Change>) {
    if before.kind != after.kind {
        out.push(Change::Block {
            block: BlockRecord::of(after),
        });
        return;
    }
    let mut fields = BTreeMap::new();
    let parent = |b: &Block| {
        b.parent
            .as_ref()
            .map_or_else(String::new, |p| p.as_str().to_owned())
    };
    if before.parent != after.parent {
        fields.insert("p".to_owned(), parent(after));
    }
    if before.order != after.order {
        fields.insert("o".to_owned(), after.order.clone());
    }
    if before.attrs != after.attrs {
        fields.insert("a".to_owned(), after.attrs.clone());
    }
    if before.props != after.props {
        fields.insert("x".to_owned(), after.props.clone());
    }
    if !fields.is_empty() {
        out.push(Change::Fields {
            id: after.id.clone(),
            fields,
        });
    }
    if after.kind == BlockKind::Paragraph && before.content != after.content {
        let delta = content_delta(&before.content, &after.content);
        if !delta.is_empty() {
            out.push(Change::Text {
                id: after.id.clone(),
                delta,
            });
        }
    }
}

/// Blocks as they were before a transaction and as it left them.
#[derive(Clone, Debug, Default)]
pub struct Step {
    /// Pre-images (`None` = the block did not exist).
    pub before: HashMap<BlockId, Option<Block>>,
    /// Post-images.
    pub after: HashMap<BlockId, Option<Block>>,
    /// Ids in the order they were first touched.
    pub order: Vec<BlockId>,
    /// Flat-map entries the transaction wrote, with their previous values.
    pub entries: Vec<(String, String, Option<String>, Option<String>)>,
    /// The story the blocks belong to. Outside the body, blocks are shared
    /// as their part's XML rather than one by one.
    pub story: StoryTarget,
}

impl Step {
    /// Whether the step changed nothing.
    pub fn is_empty(&self) -> bool {
        self.order
            .iter()
            .all(|id| same(self.before.get(id), self.after.get(id)))
            && self.entries.iter().all(|(_, _, old, new)| old == new)
    }

    /// The collaborative changes of the step, parents before children.
    pub fn changes(&self) -> Vec<Change> {
        let mut out = Vec::new();
        let blocks = if self.story == StoryTarget::Body {
            &self.order[..]
        } else {
            &[]
        };
        for id in blocks {
            let before = self.before.get(id).and_then(Option::as_ref);
            let after = self.after.get(id).and_then(Option::as_ref);
            match (before, after) {
                (None, Some(b)) => out.push(Change::Block {
                    block: BlockRecord::of(b),
                }),
                (Some(_), None) => out.push(Change::Remove { id: id.clone() }),
                (Some(a), Some(b)) => block_changes(a, b, &mut out),
                (None, None) => {}
            }
        }
        for (container, key, old, new) in &self.entries {
            if old != new {
                out.push(Change::Entry {
                    container: container.clone(),
                    key: key.clone(),
                    value: new.clone(),
                });
            }
        }
        out
    }

    /// The step that undoes this one.
    pub fn inverse(&self) -> Step {
        Step {
            before: self.after.clone(),
            after: self.before.clone(),
            order: self.order.iter().rev().cloned().collect(),
            entries: self
                .entries
                .iter()
                .rev()
                .map(|(c, k, old, new)| (c.clone(), k.clone(), new.clone(), old.clone()))
                .collect(),
            story: self.story.clone(),
        }
    }

    /// Folds a later step into this one (typing runs merge into one undo step).
    pub fn merge(&mut self, later: Step) {
        if self.order.is_empty() && self.entries.is_empty() {
            self.story = later.story.clone();
        }
        for id in later.order {
            if !self.before.contains_key(&id) {
                self.before
                    .insert(id.clone(), later.before.get(&id).cloned().flatten());
                self.order.push(id.clone());
            }
            self.after
                .insert(id.clone(), later.after.get(&id).cloned().flatten());
        }
        self.entries.extend(later.entries);
    }
}

fn same(a: Option<&Option<Block>>, b: Option<&Option<Block>>) -> bool {
    match (a.and_then(Option::as_ref), b.and_then(Option::as_ref)) {
        (None, None) => true,
        (Some(x), Some(y)) => {
            x.kind == y.kind
                && x.parent == y.parent
                && x.order == y.order
                && x.attrs == y.attrs
                && x.props == y.props
                && x.content == y.content
        }
        _ => false,
    }
}

/// An open transaction on one of a document's stories.
pub struct Txn<'d> {
    /// The document.
    pub doc: &'d mut Document,
    step: Step,
}

impl<'d> Txn<'d> {
    /// Starts a transaction on a story.
    pub fn new(doc: &'d mut Document, story: &StoryTarget) -> Self {
        let story = if doc.has_story(story) {
            story.clone()
        } else {
            StoryTarget::Body
        };
        Self {
            doc,
            step: Step {
                story,
                ..Step::default()
            },
        }
    }

    /// The story being changed.
    pub fn story(&self) -> &Story {
        self.doc.story(&self.step.story)
    }

    fn story_mut(&mut self) -> &mut Story {
        if self.step.story == StoryTarget::Body {
            self.doc.body_dirty = true;
        }
        self.doc.story_mut(&self.step.story)
    }

    fn touch(&mut self, id: &BlockId) {
        if !self.step.before.contains_key(id) {
            let pre = self.story().get(id).cloned();
            self.step.before.insert(id.clone(), pre);
            self.step.order.push(id.clone());
        }
    }

    /// A block (read-only).
    pub fn get(&self, id: &BlockId) -> Option<&Block> {
        self.story().get(id)
    }

    /// A block, for changing.
    pub fn block_mut(&mut self, id: &BlockId) -> Option<&mut Block> {
        if !self.story().contains(id) {
            return None;
        }
        self.touch(id);
        self.story_mut().get_mut(id)
    }

    /// Adds (or replaces) a block.
    pub fn insert(&mut self, block: Block) {
        self.touch(&block.id);
        self.story_mut().insert(block);
    }

    /// Removes a block and everything inside it.
    pub fn remove(&mut self, id: &BlockId) {
        let mut ids = Vec::new();
        self.story().walk_from(id, &mut |b| ids.push(b.id.clone()));
        for i in &ids {
            self.touch(i);
        }
        self.story_mut().remove(id);
    }

    /// A fresh block id.
    pub fn new_id(&self) -> BlockId {
        self.doc.next_block_id()
    }

    /// Ends the transaction. A header, footer or note is written back to
    /// its part, which is how other peers receive the change.
    pub fn finish(mut self) -> Step {
        for id in &self.step.order {
            let post = self.story().get(id).cloned();
            self.step.after.insert(id.clone(), post);
        }
        if !self.step.order.is_empty() {
            match &self.step.story {
                StoryTarget::Body => {}
                StoryTarget::Part(name) => self.doc.write_part_story(name),
                StoryTarget::Note { endnote, id } => self.doc.write_notes(*endnote, Some(*id)),
            }
        }
        self.step
    }
}

/// Applies a step's post-images to a document (undo and redo).
pub fn apply_step(doc: &mut Document, step: &Step) {
    if !doc.has_story(&step.story) {
        return;
    }
    let story = doc.story_mut(&step.story);
    // Remove first (children before parents is handled by subtree removal),
    // then insert parents before children so ordering keys resolve.
    for id in step.order.iter().rev() {
        if matches!(step.after.get(id), Some(None)) && story.contains(id) {
            story.remove_one(id);
        }
    }
    for id in &step.order {
        if let Some(Some(b)) = step.after.get(id) {
            story.insert(b.clone());
        }
    }
    match &step.story {
        StoryTarget::Body => doc.body_dirty = true,
        StoryTarget::Part(name) => doc.write_part_story(name),
        StoryTarget::Note { endnote, id } => doc.write_notes(*endnote, Some(*id)),
    }
}
