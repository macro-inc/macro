//! AutoLink creation across one or several adjacent text nodes.
use super::*;
fn content_valid(
    st: &impl Read,
    start: usize,
    end: usize,
    text: &[u16],
    nodes: &[NodeKey],
    cfg: &AutoLinkConfig,
) -> bool {
    let before = if start > 0 {
        is_separator(text.get(start - 1).copied(), &cfg.separator_regex)
    } else {
        nodes
            .first()
            .is_some_and(|n| neighbor_valid(st, *n, true, cfg))
    };
    before
        && if end < text.len() {
            is_separator(text.get(end).copied(), &cfg.separator_regex)
        } else {
            nodes
                .last()
                .is_some_and(|n| neighbor_valid(st, *n, false, cfg))
        }
}
fn extract_nodes(
    st: &impl Read,
    nodes: &[NodeKey],
    start: usize,
    end: usize,
) -> (usize, Vec<NodeKey>, Vec<NodeKey>) {
    let mut offset = 0;
    let mut matching_offset = 0;
    let mut matching = Vec::new();
    let mut after = Vec::new();
    for &node in nodes {
        let size = st.text_content_size(node).get() as usize;
        if offset + size <= start {
            matching_offset += size;
        } else if offset >= end {
            after.push(node);
        } else {
            matching.push(node);
        }
        offset += size;
    }
    (matching_offset, matching, after)
}
fn copy_text(tx: &mut Transaction<'_>, source: NodeKey, text: &str) -> Result<Id<Text>> {
    let data = tx.text_data(source)?.clone();
    let copy = tx.create_text(text)?;
    tx.text(copy)?
        .set_format(data.format)?
        .set_detail(data.detail)?
        .set_style(&data.style)?;
    Ok(copy)
}
fn create_from(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
    start: usize,
    end: usize,
    m: &LinkMatcherResult,
) -> Result<Option<NodeKey>> {
    let Some(&first) = nodes.first() else {
        return Ok(None);
    };
    let link = create_auto_link_node(tx, &m.url, m.attributes.clone().unwrap_or_default())?;
    if nodes.len() == 1 {
        let parts = tx
            .text(first)?
            .split_text(&[Utf16Offset(start as u32), Utf16Offset(end as u32)])?;
        let selected = if start == 0 { 0 } else { 1 };
        let part = *parts
            .get(selected)
            .ok_or(Error::Invariant("invalid autolink split"))?;
        let remaining = parts.get(selected + 1).copied();
        let text = copy_text(tx, part, &m.text)?;
        tx.append(link, &[text.key()])?;
        tx.replace(part, link, false)?;
        return Ok(remaining);
    }
    let mut offset = tx.text_content_size(first).get() as usize;
    let first_part = if start == 0 {
        first
    } else {
        *tx.text(first)?
            .split_text(&[Utf16Offset(start as u32)])?
            .get(1)
            .ok_or(Error::Invariant("invalid autolink start"))?
    };
    let mut link_nodes = Vec::new();
    let mut remaining = None;
    for &node in &nodes[1..] {
        let size = tx.text_content_size(node).get() as usize;
        if offset < end {
            if offset + size <= end {
                link_nodes.push(node);
            } else {
                let parts = tx
                    .text(node)?
                    .split_text(&[Utf16Offset((end - offset) as u32)])?;
                if let Some(&part) = parts.first() {
                    link_nodes.push(part);
                }
                remaining = parts.get(1).copied();
            }
        }
        offset += size;
    }
    let selection = tx.selection().cloned();
    let selected_first = selection
        .as_ref()
        .map(|s| s.nodes(tx.view()))
        .transpose()?
        .and_then(|nodes| nodes.into_iter().find(|k| tx.is_text(*k)))
        == Some(first_part);
    let first_text = tx.text_content(first_part).into_owned();
    let text = copy_text(tx, first_part, &first_text)?;
    let mut children = vec![text.key()];
    children.extend(link_nodes);
    tx.append(link, &children)?;
    if selected_first {
        match selection {
            Some(Selection::Range(range)) => {
                tx.text(text)?.select(
                    Some(Utf16Offset(range.anchor.offset())),
                    Some(Utf16Offset(range.focus.offset())),
                )?;
            }
            Some(Selection::Node(_)) => {
                let size = tx.text_content_size(text);
                tx.text(text)?.select(Some(Utf16Offset(0)), Some(size))?;
            }
            _ => {}
        }
    }
    tx.replace(first_part, link, false)?;
    Ok(remaining)
}
pub(super) fn handle_link_creation(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
    cfg: &AutoLinkConfig,
) -> Result<()> {
    if nodes
        .iter()
        .any(|n| tx.parent(*n).is_some_and(|p| linked(tx, p)))
    {
        return Ok(());
    }
    let mut current = nodes.to_vec();
    let initial: Vec<u16> = nodes
        .iter()
        .flat_map(|n| tx.text_content(*n).encode_utf16().collect::<Vec<_>>())
        .collect();
    let mut text = initial.clone();
    let mut invalid_end = 0;
    while let Some(m) = first_match(&String::from_utf16_lossy(&text), cfg) {
        let start = m.index.get() as usize;
        let end = start
            .checked_add(m.length as usize)
            .ok_or(Error::Invariant("autolink match overflow"))?;
        if m.length == 0 || end > text.len() {
            return Err(Error::Invariant(
                "autolink matcher returned an invalid range",
            ));
        }
        if content_valid(
            tx,
            invalid_end + start,
            invalid_end + end,
            &initial,
            &current,
            cfg,
        ) {
            let (offset, matching, after) =
                extract_nodes(tx, &current, invalid_end + start, invalid_end + end);
            if matching
                .iter()
                .any(|n| tx.parent(*n).is_some_and(|p| linked(tx, p)))
            {
                invalid_end += end;
                text.drain(..end);
                continue;
            }
            let remaining = create_from(
                tx,
                &matching,
                invalid_end + start - offset,
                invalid_end + end - offset,
                &m,
            )?;
            current = remaining.into_iter().chain(after).collect();
            changed(tx, Some(m.url), None);
            invalid_end = 0;
        } else {
            invalid_end += end;
        }
        text.drain(..end);
    }
    Ok(())
}
