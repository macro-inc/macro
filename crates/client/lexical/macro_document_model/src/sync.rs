//! Application policy and same-update draft preservation around remote edits.
use crate::nodes::{CommentNode, CompletionNode};
use lexical_loro::SyncPolicy;
use lexical_model::*;
mod draft_count;
/// Synced Macro content excludes ephemeral completion and draft wrappers.
pub struct MacroSyncPolicy {
    root_search_text: bool,
}
/// Shared projection policy for all collaborative Macro documents.
pub static MACRO_SYNC_POLICY: MacroSyncPolicy = MacroSyncPolicy {
    root_search_text: false,
};
/// Root state keys whose live values survive incoming updates: Source's live
/// reconciliation updates root children and leaves its live id and metadata alone.
pub const RETAINED_LIVE_ROOT_STATE: &[&str] = &["id", "documentMetadata"];
/// Macro writer with the configured root search index enabled.
pub static MACRO_SEARCH_TEXT_SYNC_POLICY: MacroSyncPolicy = MacroSyncPolicy {
    root_search_text: true,
};
/// The own fields Source's import changes: computed at export, cleared by `|| undefined`
/// on import, or never imported. The one table behind stored normalization, stored
/// comparison and the null-alias canonicalization.
///
/// Inventory 2d0e8174, class column. Source control: storedFieldSync.test.ts (fixture
/// provenance in document_session/tests/testdata/source-stored-field-sync).
fn normalized_fields(node_type: &str) -> &'static [&'static str] {
    match node_type {
        "table" => &["frozenColumnCount", "frozenRowCount", "rowStriping"],
        "tablecell" => &["width"],
        "listitem" => &["checked"],
        "code" | "custom-code" => &["language", "theme"],
        "code-highlight" => &["highlightType"],
        "pr-mention" => &["id", "url"],
        "classed-block" => &["attributes"],
        _ => &[],
    }
}
impl SyncPolicy for MacroSyncPolicy {
    fn writes_root_search_text(&self) -> bool {
        self.root_search_text
    }
    fn root_search_text_id(
        &self,
        view: StateRef<'_>,
        key: NodeKey,
    ) -> std::result::Result<Option<String>, lexical_loro::ProjectionError> {
        Ok(view
            .get_state(key, &crate::node_ids::ID_STATE)?
            .filter(|id| !id.is_empty()))
    }

    fn canonicalize_node_json(&self, node: &mut SerializedNode) {
        // These specific optional fields use null/unset aliases across source and
        // native exports. Code getters omit unset values; table imports may
        // retain explicit null. The persisted Loro values remain untouched.
        // colWidths is not aliased: Source keeps a stored null raw (TableNode.updateFromJSON
        // setColWidths, LexicalTable.dev.mjs :3775) and native ColumnWidths holds Null. A
        // pr-mention id is never aliased; only its url is optional.
        let node_type = node
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned();
        for field in normalized_fields(&node_type) {
            if node_type == "pr-mention" && *field == "id" {
                continue;
            }
            if node.get(*field).is_some_and(serde_json::Value::is_null) {
                node.remove(*field);
            }
        }
    }

    fn stored_normalized_fields(&self, node_type: &str) -> &'static [&'static str] {
        normalized_fields(node_type)
    }
    fn remote_update_defaults(&self, node_type: &str) -> &'static [(&'static str, &'static str)] {
        // Source control source-remote-code-default.source-control.test.ts: the code-prism
        // transform sets PrismTokenizer.defaultLanguage ('plaintext', CustomCodeNode.ts:82) on a
        // remote reconcile's unset language; a load (setEditorState) runs no transform.
        match node_type {
            "custom-code" => &[("language", "plaintext")],
            _ => &[],
        }
    }
    fn normalize_stored(
        &self,
        node: &mut SerializedNode,
        parent: &mut dyn FnMut() -> std::result::Result<
            Option<SerializedNode>,
            lexical_loro::ProjectionError,
        >,
    ) -> std::result::Result<(), lexical_loro::ProjectionError> {
        use serde_json::Value;
        let falsy = |value: &Value| match value {
            Value::Null => true,
            Value::Bool(value) => !value,
            Value::Number(number) => number.as_f64() == Some(0.0),
            Value::String(text) => text.is_empty(),
            _ => false,
        };
        let clear = |node: &mut SerializedNode, field: &str, when: &dyn Fn(&Value) -> bool| {
            if node.get(field).is_some_and(when) {
                node.remove(field);
            }
        };
        match node.get("type").and_then(Value::as_str) {
            // Table: `x ? x : undefined` at export. `setWidth(width || undefined)`,
            // setLanguage/setTheme/highlight `|| undefined`.
            Some(
                node_type @ ("table" | "tablecell" | "code" | "custom-code" | "code-highlight"),
            ) => {
                for field in normalized_fields(node_type) {
                    clear(node, field, &falsy);
                }
            }
            // The constructor: a GitHub PR URL id moves into a falsy url (nodes/wire.rs).
            Some("pr-mention") => {
                let id = node
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                if crate::nodes::is_github_pull_request_url(&id) {
                    node.insert("id".into(), Value::String(String::new()));
                    if node.get("url").is_none_or(&falsy) {
                        node.insert("url".into(), Value::String(id));
                    }
                } else {
                    clear(node, "url", &falsy);
                }
            }
            // importJSON never restores attributes.
            Some("classed-block") => clear(node, "attributes", &|_| true),
            // getChecked: Boolean(checked) in a check list, undefined otherwise.
            Some("listitem") => {
                let Some(parent) = parent()? else {
                    return Ok(());
                };
                if parent.get("listType").and_then(Value::as_str) == Some("check") {
                    let checked = node.get("checked").is_some_and(|value| !falsy(value));
                    node.insert("checked".into(), Value::Bool(checked));
                } else {
                    node.remove("checked");
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn own_undefined_fields(&self, node_type: &str) -> &[String] {
        crate::policy::own_undefined_fields(node_type)
    }
    fn comparison_kind(&self, node_type: &str) -> lexical_loro::ComparisonKind {
        match node_type {
            Paragraph::TYPE => lexical_loro::ComparisonKind::Paragraph,
            Text::TYPE
            | Tab::TYPE
            | lexical_rich_nodes::code::CodeHighlightNode::TYPE
            | crate::nodes::DiffTextNode::TYPE
            | crate::nodes::UnlinkedTextNode::TYPE => lexical_loro::ComparisonKind::Text,
            _ => lexical_loro::ComparisonKind::Exact,
        }
    }
    fn allows_null_text(&self, node_type: &str) -> bool {
        node_type == "await"
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
    fn retained_live_root_state(&self) -> &'static [&'static str] {
        RETAINED_LIVE_ROOT_STATE
    }
    fn local_state_keys(&self) -> &'static [&'static str] {
        &["local"]
    }
    fn local_state_update_tag(&self) -> Option<&'static str> {
        Some(crate::peer::LOCAL_STATUS_TAG)
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
    fn indent_is_tree_depth(&self, ty: &str) -> bool {
        ty == "listitem"
    }
    fn keep_local_on_remote(&self, _: &str) -> &'static [&'static str] {
        &[]
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
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> crate::ModelResult<()> {
        draft_count::update(tx, commit)
    }
}
