//! Shared list-marker reads; platform drawing never reconstructs list policy.
use crate::*;
use lexical_rich_nodes::list::{
    ListItemNode, ListNode, ListType,
    item::get_checked,
    utils::{get_list_depth, is_nested_list_node},
};

/// Model-owned visual marker for one attached list item.
#[derive(Debug, uniffi::Enum)]
pub enum FfiListMarkerKind {
    /// Unordered list marker.
    Bullet,
    /// Model-normalized ordered-list number.
    Number {
        /// Exact current item value, including non-default list starts.
        value: i32,
    },
    /// Parent-aware checklist state.
    Check {
        /// Current shared model state.
        checked: bool,
    },
    /// An item that wraps a nested list and has no independent marker.
    Nested,
}

/// Generation-aware model marker and nesting facts, without platform geometry.
#[derive(Debug, uniffi::Record)]
pub struct FfiListMarker {
    /// Current attached list-item identity.
    pub key: NodeKey,
    /// Nesting starts at one for a root list.
    pub depth: u32,
    /// Shared model marker policy.
    pub kind: FfiListMarkerKind,
}

pub(super) fn markers(
    state: &EditorState,
    keys: Vec<NodeKey>,
) -> Result<Vec<FfiListMarker>, FfiSessionError> {
    let view = state.view();
    keys.into_iter()
        .map(|key| {
            let item = view
                .cast::<ListItemNode>(key)
                .filter(|_| view.is_attached(key))
                .ok_or_else(|| invalid("list marker requires a current attached list item"))?;
            let parent = view
                .parent(key)
                .and_then(|parent| view.cast::<ListNode>(parent))
                .ok_or_else(|| invalid("list marker requires its shared list parent"))?;
            let list = view.get_or_err::<ListNode>(parent).map_err(invalid)?;
            let kind = if is_nested_list_node(state, key) {
                FfiListMarkerKind::Nested
            } else {
                match list.list_type() {
                    ListType::Bullet => FfiListMarkerKind::Bullet,
                    ListType::Number => FfiListMarkerKind::Number {
                        value: view.get_or_err::<ListItemNode>(key).map_err(invalid)?.value,
                    },
                    ListType::Check => FfiListMarkerKind::Check {
                        checked: get_checked(state, item).ok_or_else(|| {
                            invalid("checklist marker requires shared checked state")
                        })?,
                    },
                }
            };
            Ok(FfiListMarker {
                key,
                depth: get_list_depth(state, parent).map_err(invalid)?,
                kind,
            })
        })
        .collect()
}
