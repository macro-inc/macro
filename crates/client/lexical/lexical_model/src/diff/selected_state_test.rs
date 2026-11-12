use super::*;
use std::cell::Cell;

thread_local! {
    static CALLS: Cell<usize> = const { Cell::new(0) };
    static UNSELECTED_CALLS: Cell<usize> = const { Cell::new(0) };
}
static LOCAL: StateKey<Option<bool>> =
    StateKey::new("local", |value| value.and_then(serde_json::Value::as_bool));

fn select_local(view: StateRef<'_>, key: NodeKey) -> Result<Option<SerializedNode>, Error> {
    assert!(
        view.contains(key),
        "a selector cannot receive a missing node"
    );
    CALLS.with(|calls| calls.set(calls.get() + 1));
    if !view.is::<Text>(key) {
        return Ok(None);
    }
    Ok(view
        .get_state(key, &LOCAL)?
        .map(|value| SerializedNode::from_iter([("local".into(), serde_json::Value::Bool(value))])))
}

fn options() -> DiffOptions {
    DiffOptions {
        selected_state: Some(select_local),
        ..DiffOptions::default()
    }
}

fn editor_text(local: Option<bool>) -> (Editor, NodeKey, Commit) {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (key, commit) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("selected")?;
            tx.set_state(text.key(), &LOCAL, local)?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(text.key())
        })
        .unwrap();
    (editor, key, commit)
}

#[test]
fn created_selected_state_is_flat_and_missing_state_emits_nothing() {
    let (_, key, commit) = editor_text(Some(false));
    let diff = commit.diff(&options()).unwrap();
    assert!(diff.ops.iter().any(|op| matches!(op,
        DiffOp::State { key: actual, state: Some(state) }
        if *actual == key && state == &SerializedNode::from_iter([("local".into(), serde_json::Value::Bool(false))])
    )));
    let (_, _, commit) = editor_text(None);
    assert!(
        !commit
            .diff(&options())
            .unwrap()
            .ops
            .iter()
            .any(|op| matches!(op, DiffOp::State { .. }))
    );
}

#[test]
fn selected_state_transitions_emit_changes_and_clear_but_not_repeated_values() {
    let (mut editor, key, _) = editor_text(None);
    for local in [Some(true), Some(false), None] {
        let (_, commit) = editor
            .update(|tx| tx.set_state(key, &LOCAL, local))
            .unwrap();
        let state = commit
            .diff(&options())
            .unwrap()
            .ops
            .into_iter()
            .find_map(|op| {
                if let DiffOp::State { key: actual, state } = op {
                    assert_eq!(actual, key);
                    Some(state)
                } else {
                    None
                }
            })
            .expect("changed selected state");
        assert_eq!(
            state,
            local.map(|value| SerializedNode::from_iter([(
                "local".into(),
                serde_json::Value::Bool(value)
            )]))
        );
        let (_, repeated) = editor
            .update(|tx| tx.set_state(key, &LOCAL, local))
            .unwrap();
        assert!(
            !repeated
                .diff(&options())
                .unwrap()
                .ops
                .iter()
                .any(|op| matches!(op, DiffOp::State { .. }))
        );
    }
    let (_, removed) = editor.update(|tx| tx.remove(key, false)).unwrap();
    removed.diff(&options()).unwrap();
}

#[derive(Clone, Debug)]
struct Unselected(bool);
impl StateValue for Unselected {
    fn to_json(&self) -> serde_json::Value {
        UNSELECTED_CALLS.with(|calls| calls.set(calls.get() + 1));
        serde_json::Value::Bool(self.0)
    }
    fn js_equal(&self, other: &Self) -> bool {
        UNSELECTED_CALLS.with(|calls| calls.set(calls.get() + 1));
        self.0 == other.0
    }
}
static UNSELECTED: StateKey<Unselected> = StateKey::new("unselected", |value| {
    UNSELECTED_CALLS.with(|calls| calls.set(calls.get() + 1));
    Unselected(value.and_then(serde_json::Value::as_bool).unwrap_or(false))
});

#[test]
fn state_only_selected_diff_does_not_export_or_compare_unselected_codecs() {
    let (mut editor, key, _) = editor_text(Some(true));
    editor
        .update(|tx| tx.set_state(key, &UNSELECTED, Unselected(true)))
        .unwrap();
    let (_, changed) = editor
        .update(|tx| tx.set_state(key, &LOCAL, Some(false)))
        .unwrap();
    UNSELECTED_CALLS.with(|calls| calls.set(0));
    assert!(
        changed
            .diff(&options())
            .unwrap()
            .ops
            .iter()
            .any(|op| matches!(op, DiffOp::State { .. }))
    );
    assert_eq!(UNSELECTED_CALLS.with(Cell::get), 0);
    let (_, text_only) = editor
        .update(|tx| tx.text(key)?.set_text_content("updated").map(|_| ()))
        .unwrap();
    UNSELECTED_CALLS.with(|calls| calls.set(0));
    assert!(
        !text_only
            .diff(&options())
            .unwrap()
            .ops
            .iter()
            .any(|op| matches!(op, DiffOp::State { .. }))
    );
    assert_eq!(UNSELECTED_CALLS.with(Cell::get), 0);
}

#[test]
fn full_state_keeps_its_existing_shape_and_never_calls_the_selector() {
    let (mut editor, key, created) = editor_text(Some(false));
    let full = DiffOptions {
        include_state: true,
        selected_state: Some(select_local),
    };
    CALLS.with(|calls| calls.set(0));
    let diff = created.diff(&full).unwrap();
    assert!(diff.ops.iter().any(|op| matches!(op,
        DiffOp::State { key: actual, state: Some(state) }
        if *actual == key && state.get("$").and_then(|value| value.get("local")) == Some(&serde_json::Value::Bool(false))
    )));
    let (_, unchanged_state) = editor
        .update(|tx| tx.text(key)?.set_text_content("updated").map(|_| ()))
        .unwrap();
    unchanged_state.diff(&full).unwrap();
    assert_eq!(CALLS.with(Cell::get), 0);
}

#[cfg(feature = "foreign-nodes")]
#[test]
fn foreign_hook_graph_never_invokes_selected_state_for_created_or_updated_nodes() {
    use crate::foreign::*;
    struct Forbidden;
    impl ForeignInstanceHooks for Forbidden {
        fn validate_instance(&self, _: &str, _: &ForeignInstance) -> Result<(), Error> {
            Err(Error::Invariant(
                "selected state must not invoke foreign hooks",
            ))
        }
        fn clone_instance(
            &self,
            _: ForeignInstanceCloneRequest,
        ) -> Result<ForeignInstanceClone, Error> {
            Err(Error::Invariant(
                "selected state must not construct foreign instances",
            ))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .install_foreign_instance_hooks(Arc::new(Forbidden))
        .unwrap();
    let (key, created) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("foreign graph")?;
            tx.set_state(text.key(), &LOCAL, Some(true))?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(text.key())
        })
        .unwrap();
    CALLS.with(|calls| calls.set(0));
    created.diff(&options()).unwrap();
    let (_, updated) = editor
        .update(|tx| tx.set_state(key, &LOCAL, Some(false)))
        .unwrap();
    updated.diff(&options()).unwrap();
    assert_eq!(CALLS.with(Cell::get), 0);
}

#[test]
fn selected_state_error_is_propagated_without_a_fallback_export() {
    fn refuse(_: StateRef<'_>, _: NodeKey) -> Result<Option<SerializedNode>, Error> {
        Err(Error::Invariant("selected-state refusal"))
    }
    let (_, _, commit) = editor_text(Some(true));
    let result = commit.diff(&DiffOptions {
        selected_state: Some(refuse),
        ..Default::default()
    });
    assert!(matches!(
        result,
        Err(Error::Invariant("selected-state refusal"))
    ));
}
