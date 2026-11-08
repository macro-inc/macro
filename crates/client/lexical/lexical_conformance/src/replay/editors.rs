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
            let id = self.bindings.save_state(state)?;
            json!({"$snapshot":id})
        } else {
            let id = integer(&args[0]["$snapshot"])? as usize;
            let state = self.saved_state(id)?.clone();
            let mut tags = TagSet::default();
            if let Some(tag) = args[1]["tag"].as_str() {
                tags.insert(tag.parse().map_err(|_| fail("tag"))?);
            }
            self.pending_install = Some(editor.set_editor_state(state, tags)?);
            if !self.causes.iter().any(|cause| cause == "setEditorState") {
                self.causes.push(json!("setEditorState"));
            }
            self.selections.set_active(None)?;
            undefined()
        };
        self.compare(op.get("ret").unwrap_or(&undefined()), &actual)
    }
    pub(crate) fn begin_slots(
        &mut self,
        tx: &mut Transaction<'_>,
        clone_active: bool,
    ) -> Result<()> {
        let states = self.bindings.snapshots()?;
        let mut live = std::collections::HashSet::new();
        for state in states
            .iter()
            .map(EditorState::view)
            .chain([tx.view(), tx.committed_state().view()])
        {
            for key in snapshot::keys(state.snapshot()) {
                if let Some(node) = state.node(key) {
                    live.insert((key, std::ptr::from_ref(node.base()) as usize));
                }
            }
        }
        self.record_ids.retain(&live)?;
        let previous_active = self.selections.active()?.map(|active| active.id);
        if clone_active {
            self.selections.set_active(None)?;
        }
        let slots = self
            .selections
            .values()?
            .into_iter()
            .enumerate()
            .map(|(id, s)| {
                if !clone_active && previous_active == Some(id) {
                    SelectionSlot::Active
                } else {
                    s.map(|s| tx.detach_selection(s))
                        .unwrap_or(SelectionSlot::Active)
                }
            })
            .collect();
        self.selections.replace_slots(slots)
    }
    pub(crate) fn capture_slots(&mut self, tx: &Transaction<'_>) -> Result<()> {
        let values = self
            .selections
            .slots()?
            .into_iter()
            .map(|slot| tx.selection_at(slot).map(|s| s.cloned()))
            .collect::<std::result::Result<_, _>>()?;
        self.selections.replace_values(values)
    }
}
