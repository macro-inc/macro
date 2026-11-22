//! Automatic-link validation and neighboring text edits.
use super::*;
fn url(st: &impl Read, node: NodeKey) -> Result<String> {
    Ok(st
        .get::<LinkNode>(node)
        .ok_or(Error::NodeTypeMismatch(node))?
        .url
        .clone())
}
fn unlink(tx: &mut Transaction<'_>, node: NodeKey) -> Result<()> {
    let old = url(tx, node)?;
    replace_with_children(tx, node)?;
    changed(tx, None, Some(old));
    Ok(())
}
pub(super) fn handle_link_edit(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    cfg: &AutoLinkConfig,
) -> Result<()> {
    if tx.children(node).any(|child| !simple(tx, child)) {
        return unlink(tx, node);
    }
    let text = tx.text_content(node).into_owned();
    let Some(m) = first_match(&text, cfg).filter(|m| m.text == text) else {
        return unlink(tx, node);
    };
    if !neighbor_valid(tx, node, true, cfg) || !neighbor_valid(tx, node, false, cfg) {
        return unlink(tx, node);
    }
    let previous = url(tx, node)?;
    if previous != m.url {
        tx.get_mut::<LinkNode>(node)?.url = m.url.clone();
        changed(tx, Some(m.url), Some(previous));
    }
    if let Some(attributes) = m.attributes {
        let rel = tx
            .get::<LinkNode>(node)
            .ok_or(Error::NodeTypeMismatch(node))?
            .rel
            .clone();
        if rel != attributes.link.rel {
            let value = attributes.link.rel.filter(|v| !v.is_empty());
            tx.get_mut::<LinkNode>(node)?.rel = value.clone();
            changed(tx, value, rel);
        }
        let target = tx
            .get::<LinkNode>(node)
            .ok_or(Error::NodeTypeMismatch(node))?
            .target
            .clone();
        if target != attributes.link.target {
            let value = attributes.link.target.filter(|v| !v.is_empty());
            tx.get_mut::<LinkNode>(node)?.target = value.clone();
            changed(tx, value, target);
        }
    }
    Ok(())
}
fn starts_tld(text: &str, email: bool) -> bool {
    let Some(tail) = text.strip_prefix('.') else {
        return false;
    };
    if email {
        tail.chars().take_while(char::is_ascii_alphabetic).count() >= 2
    } else {
        tail.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
    }
}
pub(super) fn handle_bad_neighbors(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    cfg: &AutoLinkConfig,
) -> Result<()> {
    if tx.parent(node).is_some_and(|p| linked(tx, p)) {
        return Ok(());
    }
    let previous = tx.prev_sibling(node);
    let next = tx.next_sibling(node);
    let text = tx.text_content(node).into_owned();
    if let Some(previous) = previous.filter(|p| linked(tx, *p))
        && tx.prev_sibling(node) == Some(previous)
        && tx.parent(node) == tx.parent(previous)
    {
        if !starts_separator(&text, cfg) {
            return unlink(tx, previous);
        }
        let email = tx.get::<LinkNode>(previous).is_some_and(is_email_uri);
        if starts_tld(&text, email) {
            let combined = format!("{}{text}", tx.text_content(previous));
            if first_match(&combined, cfg).is_some_and(|m| m.text == combined) {
                tx.append(previous, &[node])?;
                handle_link_edit(tx, previous, cfg)?;
                changed(tx, None, Some(url(tx, previous)?));
            }
        }
    }
    if let Some(next) = next.filter(|p| linked(tx, *p))
        && !ends_separator(&text, cfg)
        && tx.next_sibling(node) == Some(next)
        && tx.parent(node) == tx.parent(next)
    {
        unlink(tx, next)?;
    }
    Ok(())
}
