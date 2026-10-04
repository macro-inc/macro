//! Text edits on the block tree: typing, splitting and joining paragraphs,
//! and deleting ranges that may span paragraphs, tables and cells.

use super::Pos;
use super::txn::Txn;
use super::xmledit::{Element, PPR_ORDER};
use crate::model::block::{Block, BlockId, BlockKind, Story};
use crate::model::content::{Attrs, Content, Wrapper, encode_wrappers, key};
use crate::xml::{SnippetContext, parse_on_off};
use std::collections::HashMap;

/// Wrappers that text typed next to them never joins.
fn never_extends(w: &Wrapper) -> bool {
    matches!(w.local(), "del" | "moveFrom" | "fldSimple")
}

/// Run property keys that belong to a tracked change rather than to the
/// text's formatting.
fn is_revision_key(k: &str) -> bool {
    let local = k
        .strip_prefix(key::RUN_PROP)
        .map(|q| q.rsplit(':').next().unwrap_or(q));
    matches!(
        local,
        Some("ins" | "del" | "moveFrom" | "moveTo" | "rPrChange")
    )
}

/// Run property attributes of a paragraph mark (its `w:pPr/w:rPr`).
pub(super) fn mark_attrs(ppr: &str, w: &str, ctx: &SnippetContext) -> Attrs {
    if ppr.is_empty() {
        return Attrs::empty();
    }
    let Ok(tree) = ctx.parse(ppr) else {
        return Attrs::empty();
    };
    let Some(rpr) = tree.w_child(tree.root(), "rPr") else {
        return Attrs::empty();
    };
    let _ = w;
    Attrs::from_pairs(
        tree.children(rpr)
            .map(|c| {
                (
                    format!("{}{}", key::RUN_PROP, tree.qname(c)),
                    tree.snippet(c),
                )
            })
            .filter(|(k, _)| !is_revision_key(k)),
    )
}

/// The formatting text typed at `offset` gets: the character before it
/// (or after it at the paragraph start), staying inside wrappers only when
/// the caret is inside them, and the paragraph mark's in an empty paragraph.
pub(super) fn typing_attrs(block: &Block, offset: usize, w: &str, ctx: &SnippetContext) -> Attrs {
    let content = &block.content;
    if content.is_empty() {
        return mark_attrs(&block.props, w, ctx);
    }
    let base = content.typing_attrs(offset);
    let before = (offset > 0).then(|| content.attrs_at(offset - 1)).flatten();
    let after = content.attrs_at(offset);
    let stack_before = before.map(Attrs::wrappers).unwrap_or_default();
    let stack_after = after.map(Attrs::wrappers).unwrap_or_default();
    // Inside a wrapper only when both neighbours are in it.
    let mut kept: Vec<Wrapper> = Vec::new();
    let mut dropped_link = false;
    let shared = if before.is_none() {
        Vec::new()
    } else {
        stack_before
            .iter()
            .zip(stack_after.iter())
            .take_while(|(a, b)| a == b)
            .map(|(a, _)| a.clone())
            .collect::<Vec<_>>()
    };
    for (i, wrapper) in stack_before.iter().enumerate() {
        let inside = i < shared.len();
        if inside && !never_extends(wrapper) {
            kept.push(wrapper.clone());
        } else if wrapper.local() == "hyperlink" {
            dropped_link = true;
        }
    }
    let mut attrs = base
        .with(key::WRAP, encode_wrappers(&kept).as_deref())
        .without(is_revision_key);
    if dropped_link {
        let style_key = format!("{}{}:rStyle", key::RUN_PROP, w);
        if attrs
            .get(&style_key)
            .is_some_and(|v| v.contains("Hyperlink"))
        {
            attrs = attrs.with(&style_key, None);
        }
    }
    attrs
}

/// The `w:sectPr` of a paragraph's properties.
fn sect_pr(ppr: &str, w: &str, txn: &Txn<'_>) -> Option<String> {
    if !ppr.contains("sectPr") {
        return None;
    }
    let e = Element::open(ppr, "pPr", w, txn.doc.decls(), PPR_ORDER);
    e.get("sectPr").map(str::to_owned)
}

fn set_sect_pr(ppr: &str, sect: Option<String>, w: &str, txn: &Txn<'_>) -> String {
    if sect.is_none() && !ppr.contains("sectPr") {
        return ppr.to_owned();
    }
    let mut e = Element::open(ppr, "pPr", w, txn.doc.decls(), PPR_ORDER);
    e.set("sectPr", sect);
    e.finish(true)
}

/// The style a paragraph after one of `style` gets (`w:next`).
fn next_style(txn: &Txn<'_>, ppr: &str) -> Option<String> {
    let styles = &txn.doc.parts().styles;
    let ctx = SnippetContext::new(txn.doc.decls());
    let id = (!ppr.is_empty())
        .then(|| ctx.parse(ppr).ok())
        .flatten()
        .and_then(|t| {
            t.w_child(t.root(), "pStyle")
                .and_then(|s| t.val(s))
                .map(str::to_owned)
        })
        .or_else(|| styles.default_paragraph_id().map(str::to_owned))?;
    let style = styles.get(&id)?;
    style.next.clone().filter(|n| *n != id)
}

/// Splits the paragraph at `at`. The paragraph keeps its id and the text
/// before the split; a new paragraph after it takes the rest. Returns the
/// start of the new paragraph.
pub(super) fn split(txn: &mut Txn<'_>, at: &Pos) -> Option<Pos> {
    let w = txn.doc.w_prefix().to_owned();
    let p = txn.get(&at.block)?.clone();
    if p.kind != BlockKind::Paragraph {
        return None;
    }
    let len = p.content.len();
    let offset = at.offset.min(len);
    let new_id = txn.new_id();
    let order = txn.story().key_after(p.parent.as_ref(), Some(&p.id));
    let mut q = Block::new(
        new_id.clone(),
        BlockKind::Paragraph,
        p.parent.clone(),
        order,
    );
    q.attrs = strip_ids(&p.attrs);
    // The section break belongs to the original paragraph mark, which now
    // ends the second half.
    let sect = sect_pr(&p.props, &w, txn);
    let mut q_props = p.props.clone();
    let mut p_props = set_sect_pr(&p.props, None, &w, txn);
    if offset == len
        && let Some(next) = next_style(txn, &p.props)
    {
        let mut e = Element::open(&q_props, "pPr", &w, txn.doc.decls(), PPR_ORDER);
        e.set_val("pStyle", Some(&next));
        // A heading's numbering does not carry over to body text.
        if e.has("numPr") && !p.props.contains("numPr") {
            e.set("numPr", None);
        }
        q_props = e.finish(true);
    }
    if offset == 0 && len > 0 {
        // Enter at the start: an empty paragraph goes in front and the
        // text keeps its paragraph (and id, so comments stay anchored).
        let order = txn.story().key_before(p.parent.as_ref(), &p.id);
        let mut e = Block::new(
            new_id.clone(),
            BlockKind::Paragraph,
            p.parent.clone(),
            order,
        );
        e.attrs = strip_ids(&p.attrs);
        e.props = set_sect_pr(&p.props, None, &w, txn);
        txn.insert(e);
        return Some(Pos {
            block: p.id.clone(),
            offset: 0,
            upstream: false,
        });
    }
    if sect.is_some() {
        q_props = set_sect_pr(&q_props, sect, &w, txn);
    } else {
        p_props = p.props.clone();
    }
    let block = txn.block_mut(&p.id)?;
    let tail = block.content.split_off(offset);
    block.props = p_props;
    q.content = tail;
    q.props = q_props;
    txn.insert(q);
    Some(Pos {
        block: new_id,
        offset: 0,
        upstream: false,
    })
}

/// Paragraph element attributes without per-paragraph identifiers that
/// must stay unique (`w14:paraId`, `w14:textId`).
pub(super) fn strip_ids(attrs: &str) -> String {
    let mut out = String::with_capacity(attrs.len());
    let mut rest = attrs;
    while let Some(eq) = rest.find('=') {
        let name_start = rest[..eq].rfind(char::is_whitespace).map_or(0, |i| i + 1);
        let name = rest[name_start..eq].trim();
        let quote_at = rest[eq + 1..].find(['"', '\'']).map(|i| eq + 1 + i);
        let Some(q) = quote_at else {
            break;
        };
        let quote = &rest[q..=q];
        let Some(close) = rest[q + 1..].find(quote).map(|i| q + 1 + i) else {
            break;
        };
        let local = name.rsplit(':').next().unwrap_or(name);
        if !matches!(local, "paraId" | "textId") {
            out.push(' ');
            out.push_str(&rest[name_start..=close]);
        }
        rest = &rest[close + 1..];
    }
    out
}

/// Appends paragraph `b`'s content to paragraph `a` and removes `b`. The
/// joined paragraph keeps `a`'s properties, except that `b`'s section
/// break (if any) survives, since `b`'s mark ends the joined paragraph.
pub(super) fn join(txn: &mut Txn<'_>, a: &BlockId, b: &BlockId) -> Option<Pos> {
    let w = txn.doc.w_prefix().to_owned();
    let second = txn.get(b)?.clone();
    let first = txn.get(a)?.clone();
    if first.kind != BlockKind::Paragraph || second.kind != BlockKind::Paragraph {
        return None;
    }
    let caret = first.content.len();
    let sect = sect_pr(&second.props, &w, txn);
    let props = if sect.is_some() || first.props.contains("sectPr") {
        set_sect_pr(&first.props, sect, &w, txn)
    } else {
        first.props.clone()
    };
    // Children of the second paragraph's container never exist (paragraphs
    // have no children), so removing it is enough.
    txn.remove(b);
    let block = txn.block_mut(a)?;
    block.content.insert_content(caret, &second.content);
    block.props = props;
    Some(Pos {
        block: a.clone(),
        offset: caret,
        upstream: false,
    })
}

/// Pre-order positions of every block and the last position inside each.
fn doc_positions(story: &Story) -> HashMap<BlockId, (usize, usize)> {
    fn go(
        story: &Story,
        parent: Option<&BlockId>,
        n: &mut usize,
        out: &mut HashMap<BlockId, (usize, usize)>,
    ) {
        for id in story.children(parent) {
            let start = *n;
            *n += 1;
            go(story, Some(id), n, out);
            out.insert(id.clone(), (start, *n - 1));
        }
    }
    let mut out = HashMap::new();
    let mut n = 0;
    go(story, None, &mut n, &mut out);
    out
}

/// Deletes everything between two positions (`from` before `to`). Blocks
/// wholly inside the range go; table cells are emptied rather than removed;
/// the end paragraphs are joined when they are siblings. Returns where the
/// caret goes.
pub(super) fn delete_range(txn: &mut Txn<'_>, from: &Pos, to: &Pos) -> Pos {
    if from.block == to.block {
        if let Some(b) = txn.block_mut(&from.block) {
            let len = b.content.len();
            b.content.delete(from.offset.min(len), to.offset.min(len));
        }
        return Pos {
            upstream: false,
            ..from.clone()
        };
    }
    let positions = doc_positions(&txn.story());
    let (Some(&(a_at, _)), Some(&(b_at, _))) =
        (positions.get(&from.block), positions.get(&to.block))
    else {
        return from.clone();
    };
    let covered = |id: &BlockId| {
        positions
            .get(id)
            .is_some_and(|&(s, e)| s > a_at && e < b_at)
    };
    // Outermost covered blocks.
    let mut roots: Vec<(usize, BlockId)> = Vec::new();
    for b in txn.story().blocks() {
        if !covered(&b.id) {
            continue;
        }
        if b.parent.as_ref().is_some_and(|p| covered(p)) {
            continue;
        }
        roots.push((positions[&b.id].0, b.id.clone()));
    }
    roots.sort();
    for (_, id) in roots {
        let Some(block) = txn.get(&id) else {
            continue;
        };
        match block.kind {
            BlockKind::Cell => clear_cell(txn, &id),
            _ => {
                let parent = block.parent.clone();
                txn.remove(&id);
                if let Some(p) = parent {
                    ensure_cell_paragraph(txn, &p);
                }
            }
        }
    }
    // Trim the ends.
    if let Some(b) = txn.block_mut(&from.block) {
        let len = b.content.len();
        b.content.delete(from.offset.min(len), len);
    }
    if let Some(b) = txn.block_mut(&to.block) {
        let len = b.content.len();
        b.content.delete(0, to.offset.min(len));
    }
    let same_parent = txn.get(&from.block).map(|b| b.parent.clone())
        == txn.get(&to.block).map(|b| b.parent.clone());
    if same_parent {
        join(txn, &from.block, &to.block);
    }
    Pos {
        upstream: false,
        ..from.clone()
    }
}

/// Empties a cell: its first paragraph stays (without text), the rest goes.
fn clear_cell(txn: &mut Txn<'_>, cell: &BlockId) {
    let kids: Vec<BlockId> = txn.story().children(Some(cell)).to_vec();
    let keep = kids
        .iter()
        .find(|k| txn.get(k).is_some_and(|b| b.kind == BlockKind::Paragraph))
        .cloned();
    for k in &kids {
        if Some(k) != keep.as_ref() {
            txn.remove(k);
        }
    }
    match keep {
        Some(k) => {
            if let Some(b) = txn.block_mut(&k) {
                b.content = Content::new();
            }
        }
        None => ensure_cell_paragraph(txn, cell),
    }
}

/// A cell must hold at least one paragraph.
pub(super) fn ensure_cell_paragraph(txn: &mut Txn<'_>, cell: &BlockId) {
    let Some(c) = txn.get(cell) else {
        return;
    };
    if c.kind != BlockKind::Cell {
        return;
    }
    let has = txn
        .story()
        .children(Some(cell))
        .iter()
        .any(|k| txn.get(k).is_some_and(|b| b.kind == BlockKind::Paragraph));
    if has {
        return;
    }
    let last = txn.story().children(Some(cell)).last().cloned();
    let order = txn.story().key_after(Some(cell), last.as_ref());
    let id = txn.new_id();
    txn.insert(Block::new(
        id,
        BlockKind::Paragraph,
        Some(cell.clone()),
        order,
    ));
}

/// Inserts `text` at `at` with `attrs`; newlines start new paragraphs.
/// Returns the position after the text.
pub(super) fn insert_text(txn: &mut Txn<'_>, at: &Pos, text: &str, attrs: &Attrs) -> Pos {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut pos = Pos {
        upstream: false,
        ..at.clone()
    };
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            match split(txn, &pos) {
                Some(p) => pos = p,
                None => break,
            }
        }
        if line.is_empty() {
            continue;
        }
        let Some(b) = txn.block_mut(&pos.block) else {
            break;
        };
        let offset = pos.offset.min(b.content.len());
        b.content.insert(offset, line, attrs.clone());
        pos.offset = offset + crate::model::content::utf16_len(line);
    }
    pos
}

/// Whether the paragraph has its own list numbering (`w:numPr` with a
/// non-zero `w:numId` in its direct properties).
pub(super) fn has_direct_numbering(ppr: &str) -> bool {
    if !ppr.contains("numPr") {
        return false;
    }
    !ppr.contains("w:numId w:val=\"0\"")
}

/// Whether a paragraph's on/off property `w:{local}` is directly on.
#[allow(dead_code)]
pub(super) fn direct_flag(ppr: &str, local: &str, ctx: &SnippetContext) -> Option<bool> {
    let tree = ctx.parse(ppr).ok()?;
    let c = tree.w_child(tree.root(), local)?;
    Some(parse_on_off(tree.val(c)))
}
