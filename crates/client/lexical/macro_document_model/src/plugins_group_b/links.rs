//! Surface link editing and deferred autolinking with UTF-16 caret preservation.
use super::*;
use crate::{
    links::{AutoLinkMode, find_next_auto_link_match, normalize_link_url},
    nodes::UnlinkedTextNode,
};
use lexical_rich_nodes::link::{
    AutoLinkAttributes, AutoLinkNode, LinkAttributes, LinkNode, ToggleLinkAttributes,
    create_auto_link_node, create_link_node, toggle_link,
};

#[derive(Clone)]
struct Policy(AutoLinkMode);
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum LinkAction {
    Insert { url: String, label: String },
    Update { url: String, label: String },
    Url { url: Option<String> },
    Toggle { url: String },
    Unlink,
}
static LINK: CommandKey<LinkAction> = CommandKey::new("group-b.link");
pub(super) fn decode(name: &str, json: &str) -> Result<Option<Command>, Error> {
    if name != LINK.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &LINK,
        serde_json::from_str(json)?,
    ))))
}
pub(super) fn register(builder: EditorBuilder, ty: crate::EditorType) -> EditorBuilder {
    let mode = if matches!(
        ty,
        crate::EditorType::Markdown | crate::EditorType::MarkdownSync
    ) {
        AutoLinkMode::CommonTlds
    } else {
        AutoLinkMode::Protocol
    };
    builder
        .extension_state(Policy(mode))
        .plugin(Links)
        .transform::<Text>(autolink)
}
static COMMANDS: [CommandRegistration; 3] = [
    CommandRegistration {
        command: CommandKind::Extension(&LINK),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::FormatText,
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Paste,
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];
struct Links;
impl Plugin for Links {
    fn name(&self) -> &'static str {
        "group-b.links"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        match command {
            Command::Extension(extension) => {
                let Some(action) = extension.payload(&LINK) else {
                    return Ok(Handled::No);
                };
                apply(tx, action)
            }
            Command::FormatText(TextFormatType::Code) => {
                unlink(tx)?;
                Ok(Handled::No)
            }
            Command::Paste(payload) => {
                let Some(text) = payload.get("text/plain") else {
                    return Ok(Handled::No);
                };
                if tx
                    .selection()
                    .and_then(Selection::as_range)
                    .is_none_or(|range| range.is_collapsed())
                {
                    return Ok(Handled::No);
                }
                if find_next_auto_link_match(text, AutoLinkMode::Protocol)
                    .is_none_or(|found| found.index != 0)
                {
                    return Ok(Handled::No);
                }
                let Some(url) = normalize_link_url(text) else {
                    return Ok(Handled::No);
                };
                toggle_link(tx, Some(&url), ToggleLinkAttributes::default())?;
                Ok(Handled::Yes)
            }
            _ => Ok(Handled::No),
        }
    }
}
fn apply(tx: &mut Transaction<'_>, action: &LinkAction) -> Result<Handled, Error> {
    if let LinkAction::Unlink = action {
        unlink(tx)?;
        return Ok(Handled::Yes);
    }
    let input = match action {
        LinkAction::Insert { url, .. }
        | LinkAction::Update { url, .. }
        | LinkAction::Toggle { url } => url.as_str(),
        LinkAction::Url { url: Some(url) } => url.as_str(),
        _ => return Ok(Handled::No),
    };
    let Some(url) = normalize_link_url(input) else {
        return Ok(Handled::No);
    };
    match action {
        LinkAction::Insert { label, .. } => {
            let link = create_link_node(tx, &url, LinkAttributes::default())?;
            let text = tx.create_text(label)?;
            tx.append(link, &[text.key()])?;
            tx.insert_nodes(&[link.key()])?;
            if tx
                .parent(link)
                .is_some_and(|key| tx.is_root_or_shadow_root(key))
            {
                let p = tx.create(Paragraph::default())?;
                tx.insert_before(link, p, true)?;
                tx.append(p, &[link.key()])?;
                tx.select_end(p)?;
            }
            tx.select_end(link)?;
        }
        LinkAction::Toggle { .. } => toggle_link(tx, Some(&url), ToggleLinkAttributes::default())?,
        LinkAction::Url { .. } | LinkAction::Update { .. } => {
            let Some(range) = tx.selection().and_then(Selection::as_range) else {
                return Ok(Handled::No);
            };
            let nodes = range.nodes(tx.view())?;
            let mut links = Vec::new();
            for key in nodes {
                if let Some(parent) = tx.parent(key).filter(|key| tx.is::<LinkNode>(*key))
                    && !links.contains(&parent)
                {
                    links.push(parent);
                }
            }
            if links.is_empty() {
                return Ok(Handled::No);
            }
            for key in links {
                tx.get_mut::<LinkNode>(key)?.url = url.clone();
                if let LinkAction::Update { label, .. } = action {
                    let link = create_link_node(tx, &url, LinkAttributes::default())?;
                    let text = tx.create_text(label)?;
                    tx.append(link, &[text.key()])?;
                    tx.replace(key, link, false)?;
                    tx.select_end(link)?;
                }
            }
        }
        _ => {}
    }
    Ok(Handled::Yes)
}
fn unlink(tx: &mut Transaction<'_>) -> Result<bool, Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range).cloned() else {
        return Ok(false);
    };
    let nodes = range.nodes(tx.view())?;
    let mut anchor = range.anchor;
    let mut focus = range.focus;
    let mut changed = false;
    for node in nodes {
        let Some(parent) = tx.parent(node).filter(|key| tx.is_attached(*key)) else {
            continue;
        };
        if tx.is::<AutoLinkNode>(parent) {
            tx.get_mut::<AutoLinkNode>(parent)?.is_unlinked = true;
            changed = true;
        } else if tx.is::<LinkNode>(parent) {
            for child in tx.children_keys(parent)? {
                let unlinked = if tx.is_text(child) {
                    let json = tx.export_json(child)?;
                    let unlinked = tx.create(UnlinkedTextNode::default())?;
                    tx.update_from_json(unlinked, &json)?;
                    unlinked.key()
                } else {
                    child
                };
                if anchor.key() == child {
                    anchor = Point::text(unlinked, Utf16Offset(anchor.offset()));
                }
                if focus.key() == child {
                    focus = Point::text(unlinked, Utf16Offset(focus.offset()));
                }
                tx.insert_before(parent, unlinked, true)?;
            }
            tx.remove(parent, false)?;
            changed = true;
        }
    }
    if changed && let Some(mut range) = tx.selection().and_then(Selection::as_range).cloned() {
        range.anchor = Point::text(anchor.key(), Utf16Offset(anchor.offset()));
        range.focus = Point::text(focus.key(), Utf16Offset(focus.offset()));
        tx.set_selection(Some(Selection::Range(range)))?;
    }
    Ok(changed)
}
fn autolink(tx: &mut Transaction<'_>, text: Id<Text>) -> Result<(), Error> {
    if !tx.is_simple_text(text)
        || tx
            .view()
            .text(text)
            .is_some_and(|data| data.format.contains(TextFormat::CODE))
    {
        return Ok(());
    }
    if tx
        .find_matching_parent(text.key(), |state, key| {
            state.is::<LinkNode>(key) || state.is::<lexical_rich_nodes::code::CodeNode>(key)
        })
        .is_some()
    {
        return Ok(());
    }
    let mode = tx.extension::<Policy>()?.0;
    if let Some(previous) = tx
        .prev_sibling(text)
        .filter(|key| tx.is::<AutoLinkNode>(*key))
    {
        append_match(tx, previous, text.key(), mode)?;
    }
    let content = tx.text_content(text).to_string();
    let Some(found) = find_next_auto_link_match(&content, mode) else {
        return Ok(());
    };
    let start = u32::try_from(found.index).map_err(|_| Error::Invariant("link start"))?;
    let end = u32::try_from(found.last_index).map_err(|_| Error::Invariant("link end"))?;
    let range = tx
        .selection()
        .and_then(Selection::as_range)
        .filter(|range| range.is_collapsed() && range.anchor.key() == text.key())
        .cloned();
    if range
        .as_ref()
        .is_some_and(|range| (start..=end).contains(&range.anchor.offset()))
    {
        return Ok(());
    }
    let restore = range
        .filter(|range| range.anchor.offset() > end)
        .map(|range| (range.anchor.offset() - end, range));
    let offsets = if start == 0 {
        vec![Utf16Offset(end)]
    } else {
        vec![Utf16Offset(start), Utf16Offset(end)]
    };
    let parts = tx.text(text)?.split_text(&offsets)?;
    let index = usize::from(start != 0);
    let matched = *parts
        .get(index)
        .ok_or(Error::Invariant("matched link text"))?;
    let after = parts.get(index + 1).copied();
    let link = create_auto_link_node(tx, &found.url, AutoLinkAttributes::default())?;
    tx.replace(matched, link, false)?;
    tx.append(link, &[matched])?;
    if let (Some((offset, mut range)), Some(after)) = (restore, after) {
        range.anchor = Point::text(after, Utf16Offset(offset));
        range.focus = range.anchor;
        tx.set_selection(Some(Selection::Range(range)))?;
    }
    Ok(())
}
fn append_match(
    tx: &mut Transaction<'_>,
    previous: NodeKey,
    text: NodeKey,
    mode: AutoLinkMode,
) -> Result<(), Error> {
    if tx
        .get::<AutoLinkNode>(previous)
        .is_some_and(|node| node.is_unlinked)
    {
        return Ok(());
    }
    let next = tx.text_content(text).to_string();
    if next.contains(' ') {
        let url = tx
            .get::<LinkNode>(previous)
            .ok_or(Error::NodeTypeMismatch(previous))?
            .url
            .clone();
        let children = tx.children_keys(previous)?;
        let link = create_link_node(tx, &url, LinkAttributes::default())?;
        tx.replace(previous, link, false)?;
        tx.append(link, &children)?;
        return Ok(());
    }
    let old = tx.text_content(previous).to_string();
    let Some(found) = find_next_auto_link_match(&(old.clone() + &next), mode) else {
        return Ok(());
    };
    if old.contains(&found.text) {
        return Ok(());
    }
    let Some(first) = tx
        .first_child(previous)
        .filter(|key| tx.is_simple_text(*key))
    else {
        return Ok(());
    };
    let shift = found
        .raw
        .encode_utf16()
        .count()
        .saturating_sub(old.encode_utf16().count());
    if shift == 0 {
        return Ok(());
    }
    let buffer = TextBuffer::new(next);
    let shift = u32::try_from(shift).map_err(|_| Error::Invariant("link append shift"))?;
    let remaining = buffer.slice(Utf16Offset(shift)..buffer.utf16_len())?;
    tx.text(text)?.set_text_content(remaining)?;
    tx.text(first)?.set_text_content(&found.text)?;
    tx.get_mut::<LinkNode>(previous)?.url = found.url;
    Ok(())
}
