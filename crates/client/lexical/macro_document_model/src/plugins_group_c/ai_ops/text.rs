//! Source Doc text-content ops, and the write plan every AI op executes.
//! Offsets and lengths are UTF-16 code units, already validated as safe
//! integers; past-the-end offsets clamp like `String.prototype.slice`.
//!
//! Each op is planned against a read-only transaction and returns its writes,
//! so a refusal is decided before the handler touches selection, tags or nodes.
use super::{AiOpRefusal, BlockType, InsertSpec, OpResult, Scope, block_by_id, by_id, text_block};
use lexical_model::*;

/// One planned model write, executed in order by [`execute`].
#[derive(Debug)]
pub(crate) enum Write {
    /// Replace a text node's content.
    SetContent { key: NodeKey, text: String },
    /// Replace a text node's content and clear its format.
    SetPlainContent { key: NodeKey, text: String },
    /// Create a plain text node before `anchor`.
    InsertBefore { anchor: NodeKey, text: String },
    /// Create a plain text node after `anchor`.
    InsertAfter { anchor: NodeKey, text: String },
    /// Create a plain text node as the last child of `parent`.
    Append { parent: NodeKey, text: String },
    /// Remove a node.
    Remove { key: NodeKey },
    /// Remove every child of `block`.
    Clear { block: NodeKey },
    /// Remove a node (with Lexical's empty-parent cleanup), then place it.
    Move { key: NodeKey, to: Place },
    /// Replace a text node's format.
    SetFormat { key: NodeKey, format: TextFormat },
    /// Source `$retypeContainer`: replace `key` with a new block of `block`,
    /// keeping its children, and give the replacement `id`.
    Retype {
        key: NodeKey,
        block: BlockType,
        id: Option<String>,
    },
    /// Set a list item's indent (Lexical `ListItemNode.setIndent`).
    SetIndent { key: NodeKey, indent: u32 },
    /// Source `insertNode`: build `spec`, place it, and give it `id`.
    Insert {
        spec: InsertSpec,
        to: Place,
        id: Option<String>,
    },
    /// Source `$mergeBlocks`: each of `rest`, in order, appends a `separator`
    /// run and its children into `first` when it is an element, then goes.
    MergeInto {
        first: NodeKey,
        rest: Vec<NodeKey>,
        separator: String,
    },
}

/// Where [`Write::Move`] places a node, resolved after its removal.
#[derive(Debug)]
pub(crate) enum Place {
    After(NodeKey),
    Before(NodeKey),
    RootEnd,
    RootStart,
}

/// Apply a plan built by one of this module's planners.
pub(crate) fn execute(tx: &mut Transaction<'_>, writes: Vec<Write>) -> Result<(), Error> {
    for write in writes {
        match write {
            Write::SetContent { key, text } => {
                tx.text(key)?.set_text_content(&text)?;
            }
            Write::SetPlainContent { key, text } => {
                tx.text(key)?
                    .set_text_content(&text)?
                    .set_format(TextFormat::empty())?;
            }
            Write::InsertBefore { anchor, text } => {
                let node = tx.create_text(&text)?;
                tx.insert_before(anchor, node.key(), false)?;
            }
            Write::InsertAfter { anchor, text } => {
                let node = tx.create_text(&text)?;
                tx.insert_after(anchor, node.key(), false)?;
            }
            Write::Append { parent, text } => {
                let node = tx.create_text(&text)?;
                tx.append(parent, &[node.key()])?;
            }
            Write::Remove { key } => {
                tx.remove(key, false)?;
            }
            Write::Clear { block } => {
                tx.clear(block)?;
            }
            Write::Move { key, to } => {
                tx.remove(key, false)?;
                place(tx, key, to)?;
            }
            Write::Insert { spec, to, id } => {
                let mut key = build(tx, spec)?;
                // Source wraps a structurally inline block (an equation) in a
                // paragraph so it stands as its own block.
                if tx.view().is_inline(key) {
                    let paragraph = tx.create(Paragraph {})?.key();
                    tx.append(paragraph, &[key])?;
                    key = paragraph;
                }
                place(tx, key, to)?;
                if let Some(id) = id {
                    let id = lexical_node_id::LexicalNodeId::try_new(id)
                        .map_err(|_| Error::Invariant("group-c.ai-op ref is empty"))?;
                    crate::node_ids::set_id(tx, key, Some(id))?;
                }
                // Source assignRef then runs $updateAllNodeIds: a whole-doc
                // depth-first idToNodeKeyMap.set, so the last holder of a
                // duplicated id owns it and the transform regenerates the rest.
                // It also mints ids for id-less nodes anywhere in the doc;
                // native leaves that to the transform (dirty nodes only), which
                // is unreachable while load assigns every node an id.
                for record in lexical_rich_nodes::utils::dfs(tx.view(), None, None) {
                    if let Some(id) = crate::node_ids::get_id(tx.view(), record.node)? {
                        crate::node_ids::claim_id(tx, id.as_str(), record.node)?;
                    }
                }
            }
            Write::SetFormat { key, format } => {
                tx.text(key)?.set_format(format)?;
            }
            Write::Retype { key, block, id } => {
                // Rich-node constructors only wrap a model error.
                let rich = |lexical_rich_nodes::Error::Model(error)| error;
                let replacement = match block {
                    BlockType::Paragraph => tx.create(Paragraph {})?.key(),
                    BlockType::Heading(tag) => {
                        lexical_rich_nodes::heading::create_heading_node(tx, tag)
                            .map_err(rich)?
                            .key()
                    }
                    BlockType::Quote => lexical_rich_nodes::quote::create_quote_node(tx)
                        .map_err(rich)?
                        .key(),
                    // Through the registry, as `$createCodeNode` with the app's
                    // replacement (CustomCodeNode) builds it.
                    BlockType::Code(language) => {
                        lexical_rich_nodes::code::create_code_node(tx, language.as_deref(), None)
                            .map_err(rich)?
                            .key()
                    }
                };
                tx.replace(key, replacement, true)?;
                if let Some(id) = id {
                    let id = lexical_node_id::LexicalNodeId::try_new(id)
                        .map_err(|_| Error::Invariant("group-c.ai-op versioned id is empty"))?;
                    crate::node_ids::set_id(tx, replacement, Some(id))?;
                }
            }
            Write::SetIndent { key, indent } => {
                tx.set_indent(key, indent)?;
            }
            Write::MergeInto {
                first,
                rest,
                separator,
            } => {
                for node in rest {
                    if tx.view().kind(node) == Some(NodeKind::Element) {
                        if !separator.is_empty() {
                            let run = tx.create_text(&separator)?;
                            tx.append(first, &[run.key()])?;
                        }
                        let children = tx.children_keys(node)?;
                        if !children.is_empty() {
                            tx.append(first, &children)?;
                        }
                    }
                    tx.remove(node, false)?;
                }
            }
        }
    }
    Ok(())
}

/// Source `Doc.place`, through the node's own insertion hooks (a list item
/// target splits its list, as Lexical's does).
fn place(tx: &mut Transaction<'_>, key: NodeKey, to: Place) -> Result<(), Error> {
    match to {
        Place::After(anchor) => {
            tx.insert_after(anchor, key, false)?;
        }
        Place::Before(anchor) => {
            tx.insert_before(anchor, key, false)?;
        }
        Place::RootEnd => tx.append(NodeKey::ROOT, &[key])?,
        Place::RootStart => match tx.view().first_child(NodeKey::ROOT) {
            Some(first) => {
                tx.insert_before(first, key, false)?;
            }
            None => tx.append(NodeKey::ROOT, &[key])?,
        },
    }
    Ok(())
}

/// Append a plain text node to `parent`.
fn append_run(tx: &mut Transaction<'_>, parent: NodeKey, text: &str) -> Result<(), Error> {
    let run = tx.create_text(text)?;
    tx.append(parent, &[run.key()])
}

/// Source `withText`: a text run only for non-empty text.
fn with_text(
    tx: &mut Transaction<'_>,
    block: NodeKey,
    text: Option<&str>,
) -> Result<NodeKey, Error> {
    if let Some(text) = text.filter(|text| !text.is_empty()) {
        append_run(tx, block, text)?;
    }
    Ok(block)
}

/// Source `Doc.buildNode` for the block kinds this applier builds.
fn build(tx: &mut Transaction<'_>, spec: InsertSpec) -> Result<NodeKey, Error> {
    // Rich-node constructors only wrap a model error.
    let rich = |lexical_rich_nodes::Error::Model(error)| error;
    Ok(match spec {
        InsertSpec::Paragraph(text) => {
            let block = tx.create(Paragraph {})?.key();
            with_text(tx, block, text.as_deref())?
        }
        InsertSpec::Heading(tag, text) => {
            let block = lexical_rich_nodes::heading::create_heading_node(tx, tag)
                .map_err(rich)?
                .key();
            with_text(tx, block, text.as_deref())?
        }
        InsertSpec::Quote(text) => {
            let block = lexical_rich_nodes::quote::create_quote_node(tx)
                .map_err(rich)?
                .key();
            with_text(tx, block, text.as_deref())?
        }
        InsertSpec::Code { language, text } => {
            let block = lexical_rich_nodes::code::create_code_node(tx, language.as_deref(), None)
                .map_err(rich)?
                .key();
            with_text(tx, block, text.as_deref())?
        }
        InsertSpec::List { list, items } => {
            let check = list == lexical_rich_nodes::list::ListType::Check;
            let node = lexical_rich_nodes::list::create_list_node(tx, list, 1)?.key();
            for item in items {
                // Source gives check-list items an unchecked box, others none.
                let li =
                    lexical_rich_nodes::list::create_list_item_node(tx, check.then_some(false))?
                        .key();
                append_run(tx, li, &item)?;
                tx.append(node, &[li])?;
            }
            node
        }
        InsertSpec::Table(rows) => {
            use lexical_rich_nodes::table::{
                TableCellHeaderState, TableCellNode, TableNode, TableRowNode,
            };
            let table = tx.create(TableNode::default())?.key();
            for (index, cells) in rows.into_iter().enumerate() {
                let row = tx.create(TableRowNode::default())?.key();
                // Source `tables.$table`: the first row is the header row.
                let header = if index == 0 {
                    TableCellHeaderState::ROW
                } else {
                    TableCellHeaderState::NO_STATUS
                };
                for content in cells {
                    let cell = tx.create(TableCellNode::new(header, 1, None))?.key();
                    let paragraph = tx.create(Paragraph {})?.key();
                    append_run(tx, paragraph, &content)?;
                    tx.append(cell, &[paragraph])?;
                    tx.append(row, &[cell])?;
                }
                tx.append(table, &[row])?;
            }
            table
        }
        InsertSpec::Divider => tx
            .create(crate::nodes::HorizontalRuleNode::default())?
            .key(),
        InsertSpec::Equation { tex, inline } => {
            crate::nodes::create_equation_node(tx, crate::nodes::Maybe::Value(tex), Some(inline))?
                .key()
        }
    })
}

/// One text node's content as UTF-16 code units.
fn units(tx: &Transaction<'_>, key: NodeKey) -> Vec<u16> {
    tx.view()
        .text(key)
        .map(|data| data.text.as_str().encode_utf16().collect())
        .unwrap_or_default()
}

fn plain(tx: &Transaction<'_>, key: NodeKey) -> bool {
    tx.view()
        .text(key)
        .is_some_and(|data| data.format.is_empty())
}

fn is_text(tx: &Transaction<'_>, key: NodeKey) -> bool {
    tx.view().kind(key) == Some(NodeKind::Text)
}

/// A UTF-16 length as `u64` (lossless on every target).
fn wide(len: usize) -> Result<u64, Error> {
    u64::try_from(len).map_err(|_| Error::Invariant("group-c.ai-op text length exceeds u64"))
}

/// A position already capped by one run's `usize` length, back as `usize`.
fn narrow(position: u64) -> Result<usize, Error> {
    usize::try_from(position).map_err(|_| Error::Invariant("group-c.ai-op position exceeds usize"))
}

/// `String.prototype.slice` index for a non-negative offset: clamp to the end.
fn slice_index(offset: u64, len: usize) -> Result<usize, Error> {
    narrow(offset.min(wide(len)?))
}

/// Resolve a typed lookup, or return its refusal from the calling planner.
macro_rules! resolve {
    ($lookup:expr) => {
        match $lookup? {
            Ok(found) => found,
            Err(refusal) => return Ok(Err(refusal)),
        }
    };
}

/// The UTF-16 units as a string, else the split-surrogate refusal.
fn to_string(units: &[u16]) -> Result<String, AiOpRefusal> {
    String::from_utf16(units).map_err(|_| AiOpRefusal::SplitsSurrogate)
}

fn concat(parts: &[&[u16]]) -> Vec<u16> {
    parts.iter().flat_map(|part| part.iter().copied()).collect()
}

/// A single content write, or the split-surrogate refusal.
fn set_content(key: NodeKey, units: &[u16]) -> OpResult<Vec<Write>> {
    Ok(to_string(units).map(|text| vec![Write::SetContent { key, text }]))
}

/// Source `insertText`: splice into a text-run id, else into its text block.
pub(super) fn insert_text(
    tx: &Transaction<'_>,
    node: &str,
    at: u64,
    text: &str,
) -> OpResult<Vec<Write>> {
    let target = resolve!(by_id(tx, node));
    let inserted: Vec<u16> = text.encode_utf16().collect();
    if is_text(tx, target) {
        let content = units(tx, target);
        let at = slice_index(at, content.len())?;
        return set_content(
            target,
            &concat(&[&content[..at], &inserted, &content[at..]]),
        );
    }
    let block = resolve!(text_block(tx, node));
    insert_text_at(tx, block, at, text, &inserted)
}

/// Source `insertTextAt`: edges of a formatted run get a fresh plain node.
fn insert_text_at(
    tx: &Transaction<'_>,
    block: NodeKey,
    at: u64,
    text: &str,
    inserted: &[u16],
) -> OpResult<Vec<Write>> {
    let texts: Vec<NodeKey> = tx.view().all_text_nodes(block).collect();
    let (Some(&first), Some(&last)) = (texts.first(), texts.last()) else {
        return Ok(Ok(vec![Write::Append {
            parent: block,
            text: text.to_owned(),
        }]));
    };
    let mut total = 0u64;
    for key in &texts {
        total = total
            .checked_add(wide(units(tx, *key).len())?)
            .ok_or(Error::Invariant("group-c.ai-op block length exceeds u64"))?;
    }
    if at == 0 {
        if !plain(tx, first) {
            return Ok(Ok(vec![Write::InsertBefore {
                anchor: first,
                text: text.to_owned(),
            }]));
        }
        let content = units(tx, first);
        return set_content(first, &concat(&[inserted, &content]));
    }
    if at >= total {
        if !plain(tx, last) {
            return Ok(Ok(vec![Write::InsertAfter {
                anchor: last,
                text: text.to_owned(),
            }]));
        }
        let content = units(tx, last);
        return set_content(last, &concat(&[&content, inserted]));
    }
    // Walk in u64: the block total may exceed usize even when each run fits.
    let mut remaining = at;
    for key in texts {
        let content = units(tx, key);
        let size = wide(content.len())?;
        if remaining <= size {
            let split = narrow(remaining)?;
            return set_content(
                key,
                &concat(&[&content[..split], inserted, &content[split..]]),
            );
        }
        remaining -= size;
    }
    Err(Error::Invariant(
        "group-c.ai-op insert offset inside the block found no run",
    ))
}

/// Source `removeText`: `len` units from `at`, across the block's text nodes.
///
/// `at + len` is at most `MAX_SAFE_INTEGER` (checked at decode); each run's
/// bounds are capped by that run's length before converting to `usize`.
pub(super) fn remove_text(
    tx: &Transaction<'_>,
    node: &str,
    at: u64,
    len: u64,
) -> OpResult<Vec<Write>> {
    let block = resolve!(block_by_id(tx, node));
    let mut skip = at;
    let mut left = len;
    let mut writes = Vec::new();
    let texts: Vec<NodeKey> = tx.view().all_text_nodes(block).collect();
    for key in texts {
        if left == 0 {
            break;
        }
        let content = units(tx, key);
        let size = wide(content.len())?;
        if skip >= size {
            skip -= size;
            continue;
        }
        let Some(stop) = skip.checked_add(left) else {
            return Ok(Err(AiOpRefusal::RangeTooLarge));
        };
        let end = size.min(stop);
        let text = match to_string(&concat(&[
            &content[..narrow(skip)?],
            &content[narrow(end)?..],
        ])) {
            Ok(text) => text,
            Err(refusal) => return Ok(Err(refusal)),
        };
        writes.push(Write::SetContent { key, text });
        left -= end - skip;
        skip = 0;
    }
    Ok(Ok(writes))
}

/// Source `setText`: a text-run id sets that run; a block id rewrites the block.
pub(super) fn set_text(tx: &Transaction<'_>, node: &str, text: &str) -> OpResult<Vec<Write>> {
    let target = resolve!(by_id(tx, node));
    if is_text(tx, target) {
        return Ok(Ok(vec![if text.is_empty() {
            Write::Remove { key: target }
        } else {
            Write::SetContent {
                key: target,
                text: text.to_owned(),
            }
        }]));
    }
    let block = resolve!(text_block(tx, node));
    // Source `$setText` re-tokenizes code blocks through setCode: a later slice.
    if matches!(tx.type_name(block)?, "code" | "custom-code") {
        return Ok(Err(AiOpRefusal::UnsupportedOp));
    }
    let children: Vec<NodeKey> = tx.view().children(block).collect();
    let existing = children.iter().copied().find(|key| is_text(tx, *key));
    Ok(Ok(match existing {
        Some(existing) => std::iter::once(Write::SetPlainContent {
            key: existing,
            text: text.to_owned(),
        })
        .chain(
            children
                .into_iter()
                .filter(|child| *child != existing)
                .map(|key| Write::Remove { key }),
        )
        .collect(),
        None => vec![
            Write::Clear { block },
            Write::Append {
                parent: block,
                text: text.to_owned(),
            },
        ],
    }))
}

/// Source `$appendText`: extend a trailing plain run, else add one.
pub(super) fn append_text(tx: &Transaction<'_>, node: &str, text: &str) -> OpResult<Vec<Write>> {
    let block = resolve!(text_block(tx, node));
    match tx.view().last_child(block) {
        Some(last) if is_text(tx, last) && plain(tx, last) => {
            let content = units(tx, last);
            let added: Vec<u16> = text.encode_utf16().collect();
            set_content(last, &concat(&[&content, &added]))
        }
        _ => Ok(Ok(vec![Write::Append {
            parent: block,
            text: text.to_owned(),
        }])),
    }
}

/// Source `$prependText`: extend a leading plain run, else add one before it.
pub(super) fn prepend_text(tx: &Transaction<'_>, node: &str, text: &str) -> OpResult<Vec<Write>> {
    let block = resolve!(text_block(tx, node));
    Ok(Ok(match tx.view().first_child(block) {
        Some(first) if is_text(tx, first) && plain(tx, first) => {
            let content = units(tx, first);
            let added: Vec<u16> = text.encode_utf16().collect();
            return set_content(first, &concat(&[&added, &content]));
        }
        Some(first) => vec![Write::InsertBefore {
            anchor: first,
            text: text.to_owned(),
        }],
        None => vec![Write::Append {
            parent: block,
            text: text.to_owned(),
        }],
    }))
}

/// Source `replaceText` / `$replaceString`, per text run; a miss is refused.
pub(super) fn replace_text(
    tx: &Transaction<'_>,
    node: &str,
    find: &str,
    to: &str,
    scope: Scope,
) -> OpResult<Vec<Write>> {
    let block = resolve!(block_by_id(tx, node));
    let needle: Vec<u16> = find.encode_utf16().collect();
    if needle.is_empty() {
        return Ok(Err(AiOpRefusal::FindMissed));
    }
    let replacement: Vec<u16> = to.encode_utf16().collect();
    let take = |occurrence: usize| match scope {
        Scope::All => true,
        Scope::Nth { n } => occurrence as f64 == n,
    };
    let mut occurrence = 0;
    let mut writes = Vec::new();
    let texts: Vec<NodeKey> = tx.view().all_text_nodes(block).collect();
    for key in texts {
        let content = units(tx, key);
        let mut next = Vec::with_capacity(content.len());
        let mut changed = false;
        let mut index = 0;
        while index < content.len() {
            if content[index..].starts_with(&needle) {
                occurrence += 1;
                if take(occurrence) {
                    next.extend_from_slice(&replacement);
                    changed = true;
                } else {
                    next.extend_from_slice(&needle);
                }
                index += needle.len();
            } else {
                next.push(content[index]);
                index += 1;
            }
        }
        if !changed {
            continue;
        }
        if next.is_empty() {
            writes.push(Write::Remove { key });
        } else {
            match to_string(&next) {
                Ok(text) => writes.push(Write::SetContent { key, text }),
                Err(refusal) => return Ok(Err(refusal)),
            }
        }
    }
    if writes.is_empty() {
        return Ok(Err(AiOpRefusal::FindMissed));
    }
    Ok(Ok(writes))
}
