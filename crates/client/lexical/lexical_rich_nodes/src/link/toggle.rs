//! Link toggling, tri-state attribute updates and package-command routing.
use super::*;
use std::{collections::HashSet, sync::Arc};
/// Update semantics distinguish absent fields from explicit null.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum AttrUpdate {
    /// Do not update this attribute.
    #[default]
    Unset,
    /// Clear this attribute.
    Null,
    /// Store this value, including the empty string.
    Value(String),
}
impl AttrUpdate {
    fn value(&self) -> Option<String> {
        match self {
            Self::Value(s) => Some(s.clone()),
            _ => None,
        }
    }
    fn apply(&self, target: &mut Option<String>) {
        if *self != Self::Unset {
            *target = self.value();
        }
    }
}
/// Per-attribute toggle updates.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToggleLinkAttributes {
    /// Relationship tokens; Unset defaults to noreferrer in toggle_link.
    pub rel: AttrUpdate,
    /// Target update.
    pub target: AttrUpdate,
    /// Title update.
    pub title: AttrUpdate,
}
fn ancestor(st: &impl Read, node: NodeKey, include_auto: bool) -> Option<Id<LinkNode>> {
    st.find_matching_parent(node, |v, k| {
        v.is::<LinkNode>(k) && (include_auto || !v.is::<AutoLinkNode>(k))
    })
    .and_then(|k| st.view().cast(k))
}
fn attributes(attrs: &ToggleLinkAttributes, title: bool) -> LinkAttributes {
    LinkAttributes {
        rel: attrs.rel.value(),
        target: attrs.target.value(),
        title: if title { attrs.title.value() } else { None },
    }
}
fn update(
    tx: &mut Transaction<'_>,
    key: Id<LinkNode>,
    url: &str,
    attrs: &ToggleLinkAttributes,
    title: bool,
) -> Result<()> {
    let mut link = tx.get_mut::<LinkNode>(key)?;
    link.url = url.into();
    attrs.rel.apply(&mut link.rel);
    attrs.target.apply(&mut link.target);
    if title {
        attrs.title.apply(&mut link.title);
    }
    Ok(())
}
fn unwrap(tx: &mut Transaction<'_>, link: NodeKey) -> Result<()> {
    for child in tx.children_keys(link)? {
        tx.insert_before(link, child, true)?;
    }
    tx.remove(link, false)
}
fn split_link_at_selection(
    tx: &mut Transaction<'_>,
    link: Id<LinkNode>,
    extracted: &[NodeKey],
) -> Result<()> {
    let children = tx.children_keys(link)?;
    let extracted_child = |child: &NodeKey| {
        extracted.iter().any(|key| {
            tx.is_parent_of(link, *key)
                && (*key == *child || tx.is_element(*child) && tx.is_parent_of(*child, *key))
        })
    };
    let selected: Vec<_> = children.iter().copied().filter(extracted_child).collect();
    if selected.len() == children.len() {
        return unwrap(tx, link.key());
    }
    let Some(first) = children.iter().position(extracted_child) else {
        return Ok(());
    };
    let last = children
        .iter()
        .rposition(extracted_child)
        .ok_or(Error::Invariant("missing extracted child"))?;
    if first == 0 {
        for child in selected {
            tx.insert_before(link, child, true)?;
        }
    } else {
        for &child in selected.iter().rev() {
            tx.insert_after(link, child, true)?;
        }
        if last + 1 < children.len() {
            let copy = tx.copy_node(link, false)?;
            tx.insert_after(
                *selected
                    .last()
                    .ok_or(Error::Invariant("empty extraction"))?,
                copy,
                true,
            )?;
            tx.append(copy, &children[last + 1..])?;
        }
    }
    Ok(())
}
fn point_node(st: &impl Read, point: Point, delta: i32) -> Option<NodeKey> {
    if let Point::Element { key, offset } = point {
        let index = offset.0 as i64 + delta as i64;
        if index >= 0 {
            st.child_at_index(key, ChildIndex(index as u32))
        } else {
            None
        }
    } else {
        None
    }
}
/// Add/update/remove links around the active range or node selection.
pub fn toggle_link(
    tx: &mut Transaction<'_>,
    url: Option<&str>,
    mut attrs: ToggleLinkAttributes,
) -> Result<()> {
    if attrs.rel == AttrUpdate::Unset {
        attrs.rel = AttrUpdate::Value("noreferrer".into());
    }
    let Some(selection) = tx
        .selection()
        .cloned()
        .filter(|s| s.is_range() || s.is_node())
    else {
        return Ok(());
    };
    if selection.is_node() {
        for node in selection.nodes(tx.view())? {
            let existing = ancestor(tx, node, false);
            if let Some(url) = url {
                if let Some(link) = existing {
                    update(tx, link, url, &attrs, false)?;
                } else {
                    let link = create_link_node(tx, url, attributes(&attrs, false))?;
                    tx.insert_before(node, link, true)?;
                    tx.append(link, &[node])?;
                }
            } else if let Some(link) = existing {
                tx.insert_before(link, node, true)?;
                if tx.is_empty(link) {
                    tx.remove(link, false)?;
                }
            }
        }
        return Ok(());
    }
    if selection.is_collapsed() && url.is_none()
        && let Some(node) = selection.nodes(tx.view())?.first() {
            if let Some(link) = ancestor(tx, *node, false) {
                let parent = tx.parent_or_err(link)?;
                let index = tx
                    .index_within_parent(link)
                    .ok_or(Error::NoParent(link.key()))?;
                let children = tx.children_keys(link)?;
                tx.splice(parent, index, 0, &children)?;
                tx.remove(link, false)?;
            }
            return Ok(());
        }
    let nodes = tx.extract_at(SelectionSlot::Active)?;
    let Some(url) = url else {
        let mut processed = HashSet::new();
        for &node in &nodes {
            if let Some(link) = ancestor(tx, node, false).filter(|k| processed.insert(k.key())) {
                split_link_at_selection(tx, link, &nodes)?;
            }
        }
        return Ok(());
    };
    if nodes.len() == 1
        && let Some(link) = ancestor(tx, nodes[0], true) {
            return update(tx, link, url, &attrs, true);
        }
    tx.normalize_selection_at(SelectionSlot::Active)?;
    let range = tx.range_at(SelectionSlot::Active)?.clone();
    let backward = range.is_backward(tx.view())?;
    let anchor = point_node(tx, range.anchor, if backward { -1 } else { 0 });
    let focus = point_node(tx, range.focus, if backward { 0 } else { -1 });
    let mut updated = HashSet::new();
    let mut current: Option<Id<LinkNode>> = None;
    for node in nodes {
        if !tx.is_attached(node) {
            continue;
        }
        if let Some(link) = ancestor(tx, node, true) {
            if updated.insert(link.key()) {
                update(tx, link, url, &attrs, true)?;
            }
            continue;
        }
        if tx.is_element(node) {
            if !tx.is_inline(node) {
                continue;
            }
            if tx.is::<LinkNode>(node) {
                if !tx.is::<AutoLinkNode>(node)
                    && current
                        .is_none_or(|k| tx.parent(k).is_none_or(|p| !tx.is_parent_of(p, node)))
                {
                    let id = link_id(tx, node)?;
                    if updated.insert(node) {
                        update(tx, id, url, &attrs, true)?;
                    }
                    current = Some(id);
                } else {
                    unwrap(tx, node)?;
                }
                continue;
            }
        }
        if let Some(link) = current.filter(|k| tx.prev_sibling(node) == Some(k.key())) {
            tx.append(link, &[node])?;
        } else {
            let link = create_link_node(tx, url, attributes(&attrs, true))?;
            tx.insert_after(node, link, true)?;
            tx.append(link, &[node])?;
            current = Some(link);
        }
    }
    if anchor.is_some() || focus.is_some() {
        for (role, node, extra) in [
            (PointRole::Anchor, anchor, u32::from(backward)),
            (PointRole::Focus, focus, u32::from(!backward)),
        ] {
            if let Some(node) = node
                && let Some(parent) = tx.parent(node) {
                    let index =
                        tx.index_within_parent(node).ok_or(Error::NoParent(node))?.0 + extra;
                    tx.set_point_at(
                        SelectionSlot::Active,
                        role,
                        Point::element(parent, ChildIndex(index)),
                    )?;
                }
        }
        tx.normalize_selection_at(SelectionSlot::Active)?;
        let selection = tx.selection().cloned();
        tx.replace_selection(selection)?;
    }
    Ok(())
}
/// Typed package toggle payload.
#[derive(Clone, Debug)]
pub enum ToggleLinkPayload {
    /// Remove selected ordinary links.
    Remove,
    /// URL with configured default attributes and validation.
    Url(String),
    /// Explicit attributes; absent fields override configuration as upstream undefined.
    Attributes {
        /// URL, or removal.
        url: Option<String>,
        /// Per-field updates.
        attributes: ToggleLinkAttributes,
    },
}
/// Pure URL validation policy.
pub type ValidateUrl = Arc<dyn Fn(&str) -> bool + Send + Sync>;
/// Per-editor link command configuration.
#[derive(Clone, Default)]
pub struct LinkConfig {
    /// Optional validation for string commands and paste.
    pub validate_url: Option<ValidateUrl>,
    /// Defaults for string commands.
    pub attributes: Option<LinkAttributes>,
}
fn configured_attrs(config: &LinkConfig) -> ToggleLinkAttributes {
    let Some(attrs) = &config.attributes else {
        return ToggleLinkAttributes::default();
    };
    let field = |v: &Option<String>| v.clone().map(AttrUpdate::Value).unwrap_or(AttrUpdate::Null);
    ToggleLinkAttributes {
        rel: field(&attrs.rel),
        target: field(&attrs.target),
        title: field(&attrs.title),
    }
}
/// Handle TOGGLE_LINK with the upstream validation and attribute precedence.
pub fn handle_toggle_link_command(
    tx: &mut Transaction<'_>,
    payload: &ToggleLinkPayload,
    config: &LinkConfig,
) -> Result<bool> {
    match payload {
        ToggleLinkPayload::Remove => toggle_link(tx, None, ToggleLinkAttributes::default())?,
        ToggleLinkPayload::Url(url) => {
            if config.validate_url.as_ref().is_some_and(|f| !f(url)) {
                return Ok(false);
            }
            toggle_link(tx, Some(url), configured_attrs(config))?;
        }
        ToggleLinkPayload::Attributes { url, attributes } => {
            toggle_link(tx, url.as_deref(), attributes.clone())?
        }
    }
    Ok(true)
}
/// Wrap a non-collapsed range of leaves when a pasted URL passes configured validation.
pub fn paste_url_as_link(
    tx: &mut Transaction<'_>,
    text: &str,
    config: &LinkConfig,
) -> Result<bool> {
    let Some(validate) = &config.validate_url else {
        return Ok(false);
    };
    let Some(range) = tx
        .selection()
        .and_then(Selection::as_range)
        .filter(|r| !r.is_collapsed())
    else {
        return Ok(false);
    };
    if !validate(text) || range.nodes(tx.view())?.iter().any(|k| tx.is_element(*k)) {
        return Ok(false);
    }
    toggle_link(tx, Some(text), configured_attrs(config))?;
    Ok(true)
}
/// Package command identity, dispatched at Editor priority.
pub static TOGGLE_LINK: CommandKey<ToggleLinkPayload> = CommandKey::new("link.toggle");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&TOGGLE_LINK),
    priority: CommandPriority::Editor,
    placement: Placement::After,
}];
struct LinkCommands;
impl Plugin for LinkCommands {
    fn name(&self) -> &'static str {
        "link"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(payload) = command.payload(&TOGGLE_LINK) else {
            return Ok(Handled::No);
        };
        let config = tx.extension::<LinkConfig>()?.clone();
        Ok(if handle_toggle_link_command(tx, payload, &config)? {
            Handled::Yes
        } else {
            Handled::No
        })
    }
}
/// Register LinkNode, its transform, configurable defaults and the typed command listener.
pub fn register_link(b: EditorBuilder, config: LinkConfig) -> EditorBuilder {
    b.node::<LinkNode>()
        .transform::<LinkNode>(super::transform::link_node_transform)
        .extension_state(config)
        .plugin(LinkCommands)
}

#[cfg(test)]
mod test;
