//! Application policy and same-update draft preservation around remote edits.
use crate::nodes::{CommentNode, CompletionNode};
use lexical_loro::SyncPolicy;
use lexical_model::*;
/// Synced Macro content excludes ephemeral completion and draft wrappers.
pub struct MacroSyncPolicy;
/// Shared projection policy for all collaborative Macro documents.
pub static MACRO_SYNC_POLICY: MacroSyncPolicy = MacroSyncPolicy;
impl SyncPolicy for MacroSyncPolicy {
    fn canonicalize_node_json(&self, node: &mut SerializedNode) {
        // Source exportJSON omits these unset values; the open mirror record stores null.
        let fields: &[&str] = match node.get("type").and_then(serde_json::Value::as_str) {
            Some("table") => &[
                "colWidths",
                "frozenColumnCount",
                "frozenRowCount",
                "rowStriping",
            ],
            Some("tablecell") => &["width"],
            _ => &[],
        };
        for field in fields {
            if node.get(*field).is_some_and(serde_json::Value::is_null) {
                node.remove(*field);
            }
        }
    }
    fn is_dropped(&self, view: StateRef<'_>, key: NodeKey) -> bool {
        view.is::<CompletionNode>(key)
    }
    fn is_transparent(&self, view: StateRef<'_>, key: NodeKey) -> bool {
        view.get::<CommentNode>(key)
            .is_some_and(|mark| mark.is_draft)
    }
    fn is_dropped_json(&self, node: &SerializedNode) -> bool {
        node.get("type").and_then(serde_json::Value::as_str) == Some("completion")
    }
    fn is_transparent_json(&self, node: &SerializedNode) -> bool {
        node.get("type").and_then(serde_json::Value::as_str) == Some("comment-mark")
            && node.get("isDraft") == Some(&serde_json::Value::Bool(true))
    }
    fn local_state_keys(&self) -> &'static [&'static str] {
        &["local"]
    }
    fn ignore_in_remote_compare(&self, ty: &str, json: &SerializedNode) -> &'static [&'static str] {
        if matches!(ty, "image" | "video")
            && json.get("srcType").and_then(serde_json::Value::as_str) == Some("dss")
        {
            &["url"]
        } else {
            &[]
        }
    }
    fn keep_local_on_remote(&self, ty: &str) -> &'static [&'static str] {
        if ty == "listitem" { &["indent"] } else { &[] }
    }
}
/// Serialize only the synced view, retaining co-ownership and arbitrary shared state.
pub fn synced_json(state: &EditorState) -> crate::Result<serde_json::Value> {
    Ok(serde_json::to_value(lexical_loro::synced_json(
        state,
        &MACRO_SYNC_POLICY,
    )?)?)
}
/// Detached original draft and the content keys it used to wrap.
#[derive(Clone, Debug)]
pub struct LiftedDraftCommentMark {
    /// Original mark identity, valid until this update finishes.
    pub mark: Id<CommentNode>,
    /// Ordered original content; deleted and moved content is reconciled on restore.
    pub child_keys: Vec<NodeKey>,
}
/// Lift drafts before remote writes; restore them within the same update before GC.
pub fn lift_draft_comment_marks(
    tx: &mut Transaction<'_>,
) -> crate::ModelResult<Vec<LiftedDraftCommentMark>> {
    let drafts: Vec<_> = lexical_rich_nodes::utils::dfs(tx.view(), None, None)
        .into_iter()
        .filter(|entry| {
            tx.get::<CommentNode>(entry.node)
                .is_some_and(|mark| mark.is_draft)
        })
        .filter_map(|entry| tx.view().cast::<CommentNode>(entry.node))
        .collect();
    let mut lifted = Vec::new();
    for mark in drafts {
        let children = tx.children_keys(mark)?;
        for child in &children {
            tx.insert_before(mark, *child, true)?;
        }
        tx.remove(mark, true)?;
        lifted.push(LiftedDraftCommentMark {
            mark,
            child_keys: children,
        });
    }
    Ok(lifted)
}
/// Restore enclosing drafts last and create a new wrapper for each discontiguous run.
pub fn restore_draft_comment_marks(
    tx: &mut Transaction<'_>,
    lifted: &[LiftedDraftCommentMark],
) -> crate::ModelResult<()> {
    for entry in lifted.iter().rev() {
        let payload = tx.get_or_err::<CommentNode>(entry.mark)?.clone();
        let mut run = None;
        let mut reused = false;
        for child in &entry.child_keys {
            if !tx.is_attached(*child) {
                run = None;
                continue;
            }
            if run.is_none_or(|mark| tx.next_sibling(mark) != Some(*child)) {
                let mark = if reused {
                    crate::nodes::create_comment_node(
                        tx,
                        payload.mark.ids.clone(),
                        payload.thread_id.clone(),
                        Some(true),
                    )?
                } else {
                    entry.mark
                };
                reused = true;
                tx.insert_before(*child, mark, true)?;
                run = Some(mark.key());
            }
            if let Some(mark) = run {
                tx.append(mark, &[*child])?;
            }
        }
    }
    Ok(())
}
/// Lift every draft before applying remote edits in the current transaction.
pub static LIFT_DRAFT_COMMENT_MARKS: CommandKey<()> = CommandKey::new("lift-draft-comment-marks");
/// Restore drafts after remote edits in that same transaction.
pub static RESTORE_DRAFT_COMMENT_MARKS: CommandKey<()> =
    CommandKey::new("restore-draft-comment-marks");
/// Transaction-staged drafts and the published draft count.
#[derive(Clone, Debug, Default)]
pub struct DraftCommentMarks {
    /// Draft wrappers pending same-update restoration.
    pub lifted: Vec<LiftedDraftCommentMark>,
    /// Number of live draft wrappers after the last committed update.
    pub count: usize,
}
/// Command installation and post-commit draft counting for MarkdownSync.
pub struct DraftCommentPlugin;
impl DraftCommentPlugin {
    /// Add transactional draft command state to a collaborative preset.
    pub fn register(builder: EditorBuilder) -> EditorBuilder {
        builder
            .extension_state(DraftCommentMarks::default())
            .plugin(Self)
    }
}
impl Plugin for DraftCommentPlugin {
    fn name(&self) -> &'static str {
        "draft-comment-marks"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[
            CommandRegistration {
                command: CommandKind::Extension(&LIFT_DRAFT_COMMENT_MARKS),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&RESTORE_DRAFT_COMMENT_MARKS),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
        ];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> crate::ModelResult<Handled> {
        if let Command::Extension(input) = command {
            if input.payload(&LIFT_DRAFT_COMMENT_MARKS).is_some() {
                if !tx.extension::<DraftCommentMarks>()?.lifted.is_empty() {
                    return Err(Error::Invariant("draft marks already lifted"));
                }
                let lifted = lift_draft_comment_marks(tx)?;
                tx.extension_mut::<DraftCommentMarks>()?.lifted = lifted;
                return Ok(Handled::Yes);
            }
            if input.payload(&RESTORE_DRAFT_COMMENT_MARKS).is_some() {
                let lifted = tx.extension::<DraftCommentMarks>()?.lifted.clone();
                restore_draft_comment_marks(tx, &lifted)?;
                tx.extension_mut::<DraftCommentMarks>()?.lifted.clear();
                return Ok(Handled::Yes);
            }
        }
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> crate::ModelResult<()> {
        tx.extension_mut::<DraftCommentMarks>()?.count =
            lexical_rich_nodes::utils::dfs(tx.view(), None, None)
                .iter()
                .filter(|entry| {
                    tx.get::<CommentNode>(entry.node)
                        .is_some_and(|mark| mark.is_draft)
                })
                .count();
        Ok(())
    }
}
