//! Per-editor state installation, selection slots and live record identities.
use super::*;
impl Replayer {
    pub(super) fn editor_call(&mut self, op: &Value, editor: &mut Editor) -> Result<()> {
        let args = self.decode(&op["args"])?;
        let actual = if op["fn"] == "LexicalEditor.parseEditorState" {
            let mut value = crate::api::wire::json_value(args[0].clone());
            materialize_keys(&mut value)?;
            let state = if let Some(text) = value.as_str() {
                editor.parse_editor_state_str(text)?
            } else {
                editor.parse_editor_state(&serde_json::from_value(value)?)?
            };
            let id = self.saved_states.len();
            self.saved_states.push(state);
            json!({"$snapshot":id})
        } else {
            let id = integer(&args[0]["$snapshot"])? as usize;
            let state = self
                .saved_states
                .get(id)
                .ok_or_else(|| fail("state handle"))?
                .clone();
            let mut tags = TagSet::default();
            if let Some(tag) = args[1]["tag"].as_str() {
                tags.insert(tag.parse().map_err(|_| fail("tag"))?);
            }
            self.pending_install = Some(editor.set_editor_state(state, tags)?);
            if !self.causes.iter().any(|cause| cause == "setEditorState") {
                self.causes.push(json!("setEditorState"));
            }
            self.active_selection = None;
            undefined()
        };
        self.compare(op.get("ret").unwrap_or(&undefined()), &actual)
    }
    pub(super) fn begin_slots(&mut self, tx: &mut Transaction<'_>, clone_active: bool) {
        // A pointer identifies a live Rust record only. Discard dead temporary
        // addresses before an allocator can reuse them in a later transaction.
        // Handle identities remain bound, and new records get fresh identities.
        self.records.retain(|(key, pointer), _| {
            let matches = |view: StateRef<'_>| {
                view.node(*key)
                    .is_some_and(|node| std::ptr::from_ref(node.base()) as usize == *pointer)
            };
            matches(tx.view())
                || matches(tx.committed_state().view())
                || self
                    .states
                    .values()
                    .chain(self.saved_states.iter())
                    .any(|state| matches(state.view()))
        });
        let previous_active = self.active_selection;
        if clone_active {
            self.active_selection = None;
        }
        self.selections = self
            .selection_values
            .iter()
            .enumerate()
            .map(|(id, s)| {
                if !clone_active && previous_active == Some(id) {
                    SelectionSlot::Active
                } else {
                    s.clone()
                        .map(|s| tx.detach_selection(s))
                        .unwrap_or(SelectionSlot::Active)
                }
            })
            .collect();
    }
    pub(super) fn capture_slots(&mut self, tx: &Transaction<'_>) -> Result<()> {
        self.selection_values = self
            .selections
            .iter()
            .map(|slot| tx.selection_at(*slot).map(|s| s.cloned()))
            .collect::<std::result::Result<_, _>>()?;
        Ok(())
    }
}
