//! Read-only checklist metadata; hosts explicitly request this bulk snapshot.
use crate::nodes::{
    DateMentionNode, DocumentMentionNode, Maybe, TaskListViewSettings, UserMentionNode,
    get_task_list_view_settings,
};
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType, item::get_checked};

/// Priority inferred from a source trailing exclamation marker.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "lowercase")]
pub enum TaskPriority {
    /// Three or more trailing exclamation marks.
    Urgent,
    /// Two trailing exclamation marks.
    High,
    /// One trailing exclamation mark.
    Medium,
    /// Task data can supply low priority, although no text marker does.
    Low,
}

/// Mention-owned assignee data, preserving legacy absent/null identifiers.
#[derive(Clone, Debug, PartialEq)]
pub struct ChecklistAssignee {
    /// Raw deployed mention identifier; do not rewrite missing/null values.
    pub id: Maybe<String>,
    /// First display name encountered for this identifier.
    pub name: String,
}

/// One non-wrapper list item's source metadata.
#[derive(Clone, Debug, PartialEq)]
pub struct ChecklistItemMeta {
    /// Item identity in the current editor.
    pub key: NodeKey,
    /// Nested-list wrappers before the first ordinary row.
    pub leading_keys: Vec<NodeKey>,
    /// Subsequent nested-list wrappers attached to this row.
    pub attached_keys: Vec<NodeKey>,
    /// Whether the source checkbox is explicitly true.
    pub checked: bool,
    /// Full item text trimmed with ECMAScript whitespace semantics.
    pub text: String,
    /// Deduplicated mention identifiers in document order.
    pub mention_assignees: Vec<ChecklistAssignee>,
    /// First non-nullish date; absent and explicit null remain distinct.
    pub mention_due: Maybe<String>,
    /// Trailing marker priority independent of task properties.
    pub marker_priority: Option<TaskPriority>,
    /// First non-nullish task mention identifier.
    pub task_id: Maybe<String>,
}

/// One direct root checklist and its persisted display settings.
#[derive(Clone, Debug, PartialEq)]
pub struct ChecklistMeta {
    /// List identity in the current editor.
    pub list_key: NodeKey,
    /// Ordinary rows in source order, excluding nested wrappers.
    pub items: Vec<ChecklistItemMeta>,
    /// Complete stored settings, retaining unknown fields.
    pub settings: TaskListViewSettings,
}

/// Parse the source `(!{1,3})\s*$` marker without changing its whitespace set.
pub fn parse_marker_priority(text: &str) -> Option<TaskPriority> {
    let text = text.trim_end_matches(is_js_whitespace);
    match text
        .chars()
        .rev()
        .take(3)
        .take_while(|ch| *ch == '!')
        .count()
    {
        0 => None,
        1 => Some(TaskPriority::Medium),
        2 => Some(TaskPriority::High),
        _ => Some(TaskPriority::Urgent),
    }
}

/// Collect direct root checklists without registering transforms or mutating state.
/// This is an explicit bulk read, not an automatic per-keystroke listener.
pub fn collect_checklist_metadata(state: &impl Read) -> Result<Vec<ChecklistMeta>, Error> {
    let view = state.view();
    let mut lists = Vec::new();
    for key in view.children(NodeKey::ROOT) {
        let Some(list) = view.get::<ListNode>(key) else {
            continue;
        };
        if list.list_type() != ListType::Check {
            continue;
        }
        let mut items: Vec<ChecklistItemMeta> = Vec::new();
        let mut leading = Vec::new();
        for child in view.children(key) {
            if !view.is::<ListItemNode>(child) {
                continue;
            }
            if view.children(child).any(|key| view.is::<ListNode>(key)) {
                if let Some(last) = items.last_mut() {
                    last.attached_keys.push(child);
                } else {
                    leading.push(child);
                }
                continue;
            }
            let mut item = collect_item(state, child)?;
            item.leading_keys = std::mem::take(&mut leading);
            items.push(item);
        }
        lists.push(ChecklistMeta {
            list_key: key,
            items,
            settings: get_task_list_view_settings(state, key)?,
        });
    }
    Ok(lists)
}

fn collect_item(state: &impl Read, key: NodeKey) -> Result<ChecklistItemMeta, Error> {
    let view = state.view();
    let item = view
        .cast::<ListItemNode>(key)
        .ok_or(Error::NodeTypeMismatch(key))?;
    let mut meta = ChecklistItemMeta {
        key,
        leading_keys: Vec::new(),
        attached_keys: Vec::new(),
        checked: false,
        marker_priority: None,
        text: String::new(),
        mention_assignees: Vec::new(),
        mention_due: Maybe::Null,
        task_id: Maybe::Null,
    };
    visit(state, key, &mut meta);
    let text = view.text_content(key);
    meta.text = js_trim(&text).to_owned();
    meta.checked = get_checked(state, item) == Some(true);
    meta.marker_priority = parse_marker_priority(&meta.text);
    Ok(meta)
}

fn visit(state: &impl Read, key: NodeKey, meta: &mut ChecklistItemMeta) {
    let view = state.view();
    if let Some(node) = view.get::<UserMentionNode>(key) {
        if !meta
            .mention_assignees
            .iter()
            .any(|assignee| assignee.id == node.user_id)
        {
            meta.mention_assignees.push(ChecklistAssignee {
                id: node.user_id.clone(),
                name: node.display_name.clone(),
            });
        }
        return;
    }
    if let Some(node) = view.get::<DateMentionNode>(key) {
        if !matches!(meta.mention_due, Maybe::Value(_)) {
            meta.mention_due = node.date.clone();
        }
        return;
    }
    if let Some(node) = view.get::<DocumentMentionNode>(key) {
        if node.block_name.as_deref() == Some("task") && !matches!(meta.task_id, Maybe::Value(_)) {
            meta.task_id = node.document_id.clone();
        }
        return;
    }
    if view.is_element(key) {
        for child in view.children(key) {
            visit(state, child, meta);
        }
    }
}

#[cfg(test)]
mod test;
