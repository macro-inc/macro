//! Lazy preorder traversal over a borrowed model snapshot.
use lexical_model::*;
/// A preorder node and its absolute tree depth.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DfsNode {
    /// Root has depth zero.
    pub depth: u32,
    /// Visited node.
    pub node: NodeKey,
}
/// Snapshot-borrowing preorder iterator; collect before mutating a transaction.
pub struct DfsIter<'s> {
    state: StateRef<'s>,
    caret: Option<NodeCaret>,
    end: Option<NodeCaret>,
    depth: i32,
}
impl Iterator for DfsIter<'_> {
    type Item = DfsNode;
    fn next(&mut self) -> Option<Self::Item> {
        let caret = self.caret?;
        let result = DfsNode {
            depth: self.depth.max(0) as u32,
            node: caret.origin(),
        };
        if Some(caret) == self.end {
            self.caret = None;
            return Some(result);
        }
        if matches!(caret, NodeCaret::Child(_)) {
            self.depth += 1;
        }
        self.caret = caret
            .adjacent_sibling_or_parent_sibling(self.state, RootMode::Root)
            .and_then(|(next, delta)| {
                self.depth += delta;
                (Some(next) != self.end).then_some(next)
            });
        Some(result)
    }
}
fn iter(
    state: StateRef<'_>,
    start: Option<NodeKey>,
    end: Option<NodeKey>,
    direction: CaretDirection,
) -> DfsIter<'_> {
    let start = start.unwrap_or(NodeKey::ROOT);
    let caret = |key| {
        ChildCaret::new(state, key, direction)
            .map(NodeCaret::Child)
            .unwrap_or_else(|| SiblingCaret::new(key, direction).into())
    };
    let after = |key| {
        NodeCaret::from(SiblingCaret::new(key, direction))
            .adjacent_sibling_or_parent_sibling(state, RootMode::Root)
            .map(|(caret, _)| caret)
    };
    let end = if let Some(end) = end {
        caret(end)
            .adjacent_child_caret(state)
            .or_else(|| after(end))
    } else {
        after(start)
    };
    DfsIter {
        state,
        caret: Some(caret(start)),
        end,
        depth: get_depth(&state, Some(start)),
    }
}
/// Forward preorder; an explicit end is inclusive and its children are skipped.
pub fn dfs_iter(state: StateRef<'_>, start: Option<NodeKey>, end: Option<NodeKey>) -> DfsIter<'_> {
    iter(state, start, end, CaretDirection::Next)
}
/// Reverse preorder over siblings and children.
pub fn reverse_dfs_iter(
    state: StateRef<'_>,
    start: Option<NodeKey>,
    end: Option<NodeKey>,
) -> DfsIter<'_> {
    iter(state, start, end, CaretDirection::Previous)
}
/// Collect forward preorder nodes.
pub fn dfs(state: StateRef<'_>, start: Option<NodeKey>, end: Option<NodeKey>) -> Vec<DfsNode> {
    dfs_iter(state, start, end).collect()
}
/// Collect reverse preorder nodes.
pub fn reverse_dfs(
    state: StateRef<'_>,
    start: Option<NodeKey>,
    end: Option<NodeKey>,
) -> Vec<DfsNode> {
    reverse_dfs_iter(state, start, end).collect()
}
/// Adjacent sibling caret, if one exists.
pub fn get_adjacent_caret(state: StateRef<'_>, caret: Option<NodeCaret>) -> Option<SiblingCaret> {
    caret.and_then(|caret| caret.adjacent_caret(state))
}
/// Next sibling or nearest ancestor's next sibling, with a nonpositive depth delta.
pub fn get_next_sibling_or_parent_sibling(
    state: StateRef<'_>,
    node: NodeKey,
) -> Option<(NodeKey, i32)> {
    NodeCaret::from(SiblingCaret::new(node, CaretDirection::Next))
        .adjacent_sibling_or_parent_sibling(state, RootMode::Root)
        .map(|(caret, delta)| (caret.origin(), delta))
}
/// Absolute depth; root is zero and a missing node is minus one.
pub fn get_depth(state: &impl Read, node: Option<NodeKey>) -> i32 {
    let Some(mut node) = node else {
        return -1;
    };
    let mut depth = 0;
    while let Some(parent) = state.parent(node) {
        depth += 1;
        node = parent;
    }
    depth
}
/// Next node in right-to-left preorder, descending into the last child first.
pub fn get_next_right_preorder_node(state: StateRef<'_>, node: NodeKey) -> Option<NodeKey> {
    let caret = ChildCaret::new(state, node, CaretDirection::Previous)
        .map(NodeCaret::Child)
        .unwrap_or_else(|| SiblingCaret::new(node, CaretDirection::Previous).into());
    caret
        .adjacent_sibling_or_parent_sibling(state, RootMode::Root)
        .map(|(caret, _)| caret.origin())
}
#[cfg(test)]
mod test;
