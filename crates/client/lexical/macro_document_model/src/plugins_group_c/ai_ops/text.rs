//! Source Doc text-content ops. Offsets and lengths are JavaScript string
//! offsets: UTF-16 code units with `String.prototype.slice` clamping.
use super::{OpResult, Refused, Scope, block_by_id, by_id, text_block};
use lexical_model::*;

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

/// JavaScript `slice` index for a non-negative or negative offset.
fn js_index(offset: f64, len: usize) -> usize {
    if offset.is_nan() {
        return 0;
    }
    let offset = offset.trunc();
    if offset < 0.0 {
        let back = (-offset).min(len as f64) as usize;
        len - back
    } else {
        offset.min(len as f64) as usize
    }
}

/// `None` when the units are not valid UTF-16 (a split surrogate pair).
fn to_string(units: &[u16]) -> Option<String> {
    String::from_utf16(units).ok()
}

fn set_content(tx: &mut Transaction<'_>, key: NodeKey, units: &[u16]) -> OpResult<()> {
    let Some(text) = to_string(units) else {
        return Ok(Err(Refused));
    };
    tx.text(key)?.set_text_content(&text)?;
    Ok(Ok(()))
}

fn concat(parts: &[&[u16]]) -> Vec<u16> {
    parts.iter().flat_map(|part| part.iter().copied()).collect()
}

/// Source `insertText`: splice into a text-run id, else into its text block.
pub(super) fn insert_text(
    tx: &mut Transaction<'_>,
    node: &str,
    at: f64,
    text: &str,
) -> OpResult<()> {
    let Some(target) = by_id(tx, node)? else {
        return Ok(Err(Refused));
    };
    let inserted: Vec<u16> = text.encode_utf16().collect();
    if is_text(tx, target) {
        let content = units(tx, target);
        let at = js_index(at, content.len());
        return set_content(
            tx,
            target,
            &concat(&[&content[..at], &inserted, &content[at..]]),
        );
    }
    let Some(block) = text_block(tx, node)? else {
        return Ok(Err(Refused));
    };
    insert_text_at(tx, block, at, text, &inserted)
}

/// Source `insertTextAt`: edges of a formatted run get a fresh plain node.
fn insert_text_at(
    tx: &mut Transaction<'_>,
    block: NodeKey,
    at: f64,
    text: &str,
    inserted: &[u16],
) -> OpResult<()> {
    let texts: Vec<NodeKey> = tx.view().all_text_nodes(block).collect();
    let (Some(&first), Some(&last)) = (texts.first(), texts.last()) else {
        let node = tx.create_text(text)?;
        tx.append(block, &[node.key()])?;
        return Ok(Ok(()));
    };
    let total: usize = texts.iter().map(|key| units(tx, *key).len()).sum();
    if at <= 0.0 || at.is_nan() {
        if !plain(tx, first) {
            let node = tx.create_text(text)?;
            tx.insert_before(first, node.key(), false)?;
            return Ok(Ok(()));
        }
        let content = units(tx, first);
        return set_content(tx, first, &concat(&[inserted, &content]));
    }
    if at >= total as f64 {
        if !plain(tx, last) {
            let node = tx.create_text(text)?;
            tx.insert_after(last, node.key(), false)?;
            return Ok(Ok(()));
        }
        let content = units(tx, last);
        return set_content(tx, last, &concat(&[&content, inserted]));
    }
    let mut remaining = at.trunc() as usize;
    for key in texts {
        let content = units(tx, key);
        if remaining <= content.len() {
            return set_content(
                tx,
                key,
                &concat(&[&content[..remaining], inserted, &content[remaining..]]),
            );
        }
        remaining -= content.len();
    }
    Ok(Ok(()))
}

/// Source `removeText`: `len` units from `at`, across the block's text nodes.
pub(super) fn remove_text(tx: &mut Transaction<'_>, node: &str, at: f64, len: f64) -> OpResult<()> {
    let Some(block) = block_by_id(tx, node)? else {
        return Ok(Err(Refused));
    };
    let mut skip = js_index(at, usize::MAX);
    let mut left = if len.is_nan() || len <= 0.0 {
        0
    } else {
        len.trunc() as usize
    };
    // Plan every run first so a refusal (invalid UTF-16) writes nothing.
    let mut writes: Vec<(NodeKey, String)> = Vec::new();
    let texts: Vec<NodeKey> = tx.view().all_text_nodes(block).collect();
    for key in texts {
        if left == 0 {
            break;
        }
        let content = units(tx, key);
        if skip >= content.len() {
            skip -= content.len();
            continue;
        }
        let start = skip;
        let end = content.len().min(start + left);
        let Some(next) = to_string(&concat(&[&content[..start], &content[end..]])) else {
            return Ok(Err(Refused));
        };
        writes.push((key, next));
        left -= end - start;
        skip = 0;
    }
    for (key, next) in writes {
        tx.text(key)?.set_text_content(&next)?;
    }
    Ok(Ok(()))
}

/// Source `setText`: a text-run id sets that run; a block id rewrites the block.
pub(super) fn set_text(tx: &mut Transaction<'_>, node: &str, text: &str) -> OpResult<()> {
    let Some(target) = by_id(tx, node)? else {
        return Ok(Err(Refused));
    };
    if is_text(tx, target) {
        if text.is_empty() {
            tx.remove(target, false)?;
        } else {
            tx.text(target)?.set_text_content(text)?;
        }
        return Ok(Ok(()));
    }
    let Some(block) = text_block(tx, node)? else {
        return Ok(Err(Refused));
    };
    // Source `$setText` re-tokenizes code blocks through setCode: a later slice.
    if matches!(tx.type_name(block)?, "code" | "custom-code") {
        return Ok(Err(Refused));
    }
    let children: Vec<NodeKey> = tx.view().children(block).collect();
    let existing = children.iter().copied().find(|key| is_text(tx, *key));
    match existing {
        Some(existing) => {
            tx.text(existing)?
                .set_text_content(text)?
                .set_format(TextFormat::empty())?;
            for child in children {
                if child != existing {
                    tx.remove(child, false)?;
                }
            }
        }
        None => {
            tx.clear(block)?;
            let node = tx.create_text(text)?;
            tx.append(block, &[node.key()])?;
        }
    }
    Ok(Ok(()))
}

/// Source `$appendText`: extend a trailing plain run, else add one.
pub(super) fn append_text(tx: &mut Transaction<'_>, node: &str, text: &str) -> OpResult<()> {
    let Some(block) = text_block(tx, node)? else {
        return Ok(Err(Refused));
    };
    match tx.view().last_child(block) {
        Some(last) if is_text(tx, last) && plain(tx, last) => {
            let content = units(tx, last);
            let added: Vec<u16> = text.encode_utf16().collect();
            set_content(tx, last, &concat(&[&content, &added]))
        }
        _ => {
            let created = tx.create_text(text)?;
            tx.append(block, &[created.key()])?;
            Ok(Ok(()))
        }
    }
}

/// Source `$prependText`: extend a leading plain run, else add one before it.
pub(super) fn prepend_text(tx: &mut Transaction<'_>, node: &str, text: &str) -> OpResult<()> {
    let Some(block) = text_block(tx, node)? else {
        return Ok(Err(Refused));
    };
    match tx.view().first_child(block) {
        Some(first) if is_text(tx, first) && plain(tx, first) => {
            let content = units(tx, first);
            let added: Vec<u16> = text.encode_utf16().collect();
            set_content(tx, first, &concat(&[&added, &content]))
        }
        Some(first) => {
            let created = tx.create_text(text)?;
            tx.insert_before(first, created.key(), false)?;
            Ok(Ok(()))
        }
        None => {
            let created = tx.create_text(text)?;
            tx.append(block, &[created.key()])?;
            Ok(Ok(()))
        }
    }
}

/// Source `replaceText` / `$replaceString`, per text run; a miss is refused.
pub(super) fn replace_text(
    tx: &mut Transaction<'_>,
    node: &str,
    find: &str,
    to: &str,
    scope: Scope,
) -> OpResult<()> {
    let Some(block) = block_by_id(tx, node)? else {
        return Ok(Err(Refused));
    };
    let needle: Vec<u16> = find.encode_utf16().collect();
    if needle.is_empty() {
        return Ok(Err(Refused));
    }
    let replacement: Vec<u16> = to.encode_utf16().collect();
    let take = |occurrence: usize| match scope {
        Scope::All => true,
        Scope::Nth { n } => occurrence as f64 == n,
    };
    // Plan every run first so a refusal (or invalid UTF-16) writes nothing.
    let mut occurrence = 0;
    let mut writes: Vec<(NodeKey, Vec<u16>)> = Vec::new();
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
        if changed {
            writes.push((key, next));
        }
    }
    if writes.is_empty() {
        return Ok(Err(Refused));
    }
    if writes.iter().any(|(_, next)| to_string(next).is_none()) {
        return Ok(Err(Refused));
    }
    for (key, next) in writes {
        if next.is_empty() {
            tx.remove(key, false)?;
        } else if let Some(text) = to_string(&next) {
            tx.text(key)?.set_text_content(&text)?;
        }
    }
    Ok(Ok(()))
}
