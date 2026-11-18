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
                if state.node(key).is_some() {
                    live.insert((key, state.foreign_record_identity(key)?));
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
                    tx.bind_foreign_selection_identity(
                        SelectionSlot::Active,
                        self.selections
                            .identity(id)?
                            .ok_or_else(|| fail("selection identity"))?,
                    )?;
                    Ok(Some(SelectionSlot::Active))
                } else {
                    match s {
                        Some(value) => {
                            let identity = self
                                .selections
                                .identity(id)?
                                .ok_or_else(|| fail("selection identity"))?;
                            Ok(Some(match tx.foreign_selection_slot(&identity) {
                                Some(slot) => slot,
                                None => tx.detach_foreign_selection(value, identity),
                            }))
                        }
                        None => Ok(None),
                    }
                }
            })
            .collect::<Result<Vec<_>>>()?;
        self.selections.replace_slots(slots)
    }
    pub(crate) fn capture_slots(&mut self, tx: &Transaction<'_>) -> Result<()> {
        lexical_model::ForeignReadOperation::check()?;
        self.selections.synchronize(tx)?;
        self.bindings
            .capture_retired_records(tx, self.editor_id, self.version)?;
        for (id, slot) in self.selections.slots()?.into_iter().enumerate() {
            if let Some(slot) = slot {
                self.selections.save_value(
                    id,
                    tx.selection_at(slot)?
                        .map(Selection::snapshot_for_foreign_read),
                )?;
            }
        }
        Ok(())
    }
}
