//! Source Doc node ops (phase B1a): `removeNode`, `moveNode`, `formatNode` and
//! `clearNodeFormat`. Planned against a read-only transaction like the text
//! ops, so a refusal is decided before any write.
use super::text::{Place, Write};
use super::{AiOpRefusal, OpResult, Position, by_id};
use lexical_model::*;
use lexical_rich_nodes::list::ListItemNode;
use lexical_rich_nodes::list::utils::is_nested_list_node;

/// Resolve a typed lookup, or return its refusal from the calling planner.
macro_rules! resolve {
    ($lookup:expr) => {
        match $lookup? {
            Ok(found) => found,
            Err(refusal) => return Ok(Err(refusal)),
        }
    };
}

/// Source `Doc.anchor`: the node by id, climbed out of inline nodes.
pub(super) fn anchor(tx: &Transaction<'_>, id: &str) -> OpResult<NodeKey> {
    let mut key = resolve!(by_id(tx, id));
    let view = tx.view();
    while view.is_inline(key) {
        match view.parent(key) {
            Some(parent) => key = parent,
            None => break,
        }
    }
    Ok(Ok(key))
}

/// What removing `key` detaches, as Lexical does it and the native hooks port
/// it: `subtree` goes whole; each of `nodes` goes without its children, which
/// a list merge moves elsewhere.
pub(super) struct Detached {
    subtree: NodeKey,
    nodes: Vec<NodeKey>,
}

impl Detached {
    pub(super) fn contains(&self, view: StateRef<'_>, key: NodeKey) -> bool {
        key == self.subtree || view.has_ancestor(key, self.subtree) || self.nodes.contains(&key)
    }
}

/// Lexical `$removeNode`, then `ListItemNode.remove` (lexical_rich_nodes
/// list/item.rs `remove`): every parent left empty that is not a root or
/// shadow root and cannot be empty goes too; an item removed between two
/// nested-list wrappers merges their lists and removes the second wrapper.
pub(super) fn detached_by_remove(tx: &Transaction<'_>, key: NodeKey) -> Detached {
    let view = tx.view();
    let mut subtree = key;
    while let Some(parent) = view.parent(subtree) {
        let only_child = view.children(parent).count() == 1;
        if view.is_root_or_shadow_root(parent) || view.can_be_empty(parent) || !only_child {
            break;
        }
        subtree = parent;
    }
    let mut nodes = Vec::new();
    if view.is::<ListItemNode>(key)
        && let (Some(prev), Some(next)) = (view.prev_sibling(key), view.next_sibling(key))
        && is_nested_list_node(tx, prev)
        && is_nested_list_node(tx, next)
        && let (Some(left), Some(right)) = (view.first_child(prev), view.first_child(next))
    {
        merged_away(tx, left, right, &mut nodes);
        nodes.push(next);
    }
    Detached { subtree, nodes }
}

/// `merge_lists(a, b)` (lexical_rich_nodes list/format.rs): `b` goes after its
/// items move into `a`, and adjacent nested wrappers merge the same way first.
fn merged_away(tx: &Transaction<'_>, a: NodeKey, b: NodeKey, nodes: &mut Vec<NodeKey>) {
    let view = tx.view();
    if let (Some(last), Some(first)) = (view.last_child(a), view.first_child(b))
        && is_nested_list_node(tx, last)
        && is_nested_list_node(tx, first)
        && let (Some(left), Some(right)) = (view.first_child(last), view.first_child(first))
    {
        merged_away(tx, left, right, nodes);
        nodes.push(first);
    }
    nodes.push(b);
}

/// Source `removeNode`: `$byId(node).remove()`.
pub(super) fn remove_node(tx: &Transaction<'_>, node: &str) -> OpResult<Vec<Write>> {
    // `by_id` never resolves the root, whose removal Lexical refuses.
    let key = resolve!(by_id(tx, node));
    Ok(Ok(vec![Write::Remove { key }]))
}

/// Source `moveNode`: remove the anchored node, then place it.
pub(super) fn move_node(tx: &Transaction<'_>, node: &str, at: &Position) -> OpResult<Vec<Write>> {
    // `by_id` never resolves the root, so neither the moved node nor the
    // target is the root (which takes no siblings).
    let key = resolve!(anchor(tx, node));
    let to = match at {
        Position::After(id) | Position::Before(id) => {
            let target = resolve!(anchor(tx, id));
            // Source resolves the target after the removal: a target the
            // removal detached throws.
            if detached_by_remove(tx, key).contains(tx.view(), target) {
                return Ok(Err(AiOpRefusal::WrongTarget));
            }
            match at {
                Position::After(_) => Place::After(target),
                _ => Place::Before(target),
            }
        }
        Position::AppendToRoot => Place::RootEnd,
        Position::PrependToRoot => Place::RootStart,
    };
    Ok(Ok(vec![Write::Move { key, to }]))
}

/// Source `$textById`: the id must name a text node.
fn text_node(tx: &Transaction<'_>, id: &str) -> OpResult<NodeKey> {
    let key = resolve!(by_id(tx, id));
    Ok(if tx.view().kind(key) == Some(NodeKind::Text) {
        Ok(key)
    } else {
        Err(AiOpRefusal::WrongTarget)
    })
}

/// Source `formatNode`: toggle the format only when its state differs.
pub(super) fn format_node(
    tx: &Transaction<'_>,
    node: &str,
    format: TextFormatType,
    on: bool,
) -> OpResult<Vec<Write>> {
    let key = resolve!(text_node(tx, node));
    let current = tx
        .view()
        .text(key)
        .map(|data| data.format)
        .unwrap_or_default();
    Ok(Ok(if current.has(format) == on {
        Vec::new()
    } else {
        vec![Write::SetFormat {
            key,
            format: current.toggled(format, None),
        }]
    }))
}

/// Source `clearNodeFormat`: `setFormat(0)` on the text node.
pub(super) fn clear_node_format(tx: &Transaction<'_>, node: &str) -> OpResult<Vec<Write>> {
    let key = resolve!(text_node(tx, node));
    Ok(Ok(vec![Write::SetFormat {
        key,
        format: TextFormat::empty(),
    }]))
}
