//! Transaction::supersede_retained_root_state: a retained live ROOT state slot whose
//! stored copy was removed is re-recorded from its live value without dirtying nodes.
use super::*;
use serde_json::{Value, json};
use std::sync::Arc;

static META: StateKey<Arc<Value>> = StateKey::new("meta", |value| {
    Arc::new(value.cloned().unwrap_or_else(|| json!({"version": -1})))
});

fn stored_meta(state: &EditorState) -> Option<Value> {
    state
        .view()
        .export_stored_json(NodeKey::ROOT)
        .ok()?
        .get("$")?
        .get("meta")
        .cloned()
}

/// A root whose live `meta` is retained while a remote update removed its stored copy.
fn retained_without_stored_copy() -> Result<Editor, Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    editor.update(|tx| tx.set_state(NodeKey::ROOT, &META, Arc::new(json!({"version": 10}))))?;
    let mut root = editor.state().view().export_json(NodeKey::ROOT)?;
    root.remove("children");
    if let Some(Value::Object(state)) = root.get_mut("$") {
        state.shift_remove("meta");
    }
    editor.update_with(
        UpdateOptions {
            skip_transforms: true,
            tags: TagSet::from_tags([UpdateTag::Collaboration]),
        },
        |tx| tx.apply_remote_fields_retaining_state(NodeKey::ROOT, &root, &["meta"]),
    )?;
    Ok(editor)
}

#[test]
fn a_local_supersede_re_records_the_stored_slot_without_dirtying()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = retained_without_stored_copy()?;
    let before = editor.state().clone();
    assert_eq!(
        stored_meta(&before),
        None,
        "remote removal left no stored copy"
    );
    assert_eq!(
        before.view().get_state(NodeKey::ROOT, &META)?.as_ref(),
        &json!({"version": 10}),
        "the live value is retained"
    );
    let (changed, commit) = editor.update(|tx| {
        let changed = tx.supersede_retained_root_state(&META, &["meta"])?;
        assert!(!tx.has_dirty_nodes(), "the supersede marked nodes dirty");
        Ok(changed)
    })?;
    assert!(changed);
    assert!(commit.stored_state_superseded);
    assert!(!commit.is_noop());
    assert!(commit.changes.is_empty(), "no dirty marks or mutations");
    assert_eq!(stored_meta(editor.state()), Some(json!({"version": 10})));
    assert_eq!(
        stored_meta(&before),
        None,
        "the earlier committed snapshot is unchanged"
    );
    let (changed, commit) =
        editor.update(|tx| tx.supersede_retained_root_state(&META, &["meta"]))?;
    assert!(!changed, "an equal stored copy is not superseded again");
    assert!(commit.is_noop());
    Ok(())
}

#[test]
fn a_supersede_is_refused_in_collaboration_and_history_updates()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = retained_without_stored_copy()?;
    for tag in [UpdateTag::Collaboration, UpdateTag::Historic] {
        let refused = editor.update_with(
            UpdateOptions {
                skip_transforms: false,
                tags: TagSet::from_tags([tag]),
            },
            |tx| tx.supersede_retained_root_state(&META, &["meta"]),
        );
        assert!(matches!(
            refused,
            Err(Error::StoredStateSupersedeRefused { key: "meta" })
        ));
    }
    assert_eq!(stored_meta(editor.state()), None);
    Ok(())
}

struct InitialSupersede(Arc<std::sync::Mutex<Option<bool>>>);
impl Plugin for InitialSupersede {
    fn name(&self) -> &'static str {
        "initial-supersede"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        if tx.is_initializing()
            && let Ok(mut seen) = self.0.lock()
            && seen.is_none()
        {
            *seen = Some(matches!(
                tx.supersede_retained_root_state(&META, &["meta"]),
                Err(Error::StoredStateSupersedeRefused { .. })
            ));
        }
        Ok(())
    }
}

#[test]
fn a_supersede_is_refused_while_initializing() -> Result<(), Box<dyn std::error::Error>> {
    let seen = Arc::new(std::sync::Mutex::new(None));
    Editor::builder(EditorMode::Headless)
        .plugin(InitialSupersede(seen.clone()))
        .initial_state(serde_json::from_value(json!({
            "root": { "type": "root", "version": 1, "$": { "meta": { "version": 10 } }, "children": [
                { "type": "paragraph", "version": 1, "children": [] }
            ] }
        }))?)
        .build()?;
    assert_eq!(*seen.lock().map_err(|_| "lock")?, Some(true));
    Ok(())
}

struct CountPriors(Arc<std::sync::atomic::AtomicUsize>);
impl Plugin for CountPriors {
    fn name(&self) -> &'static str {
        "count-priors"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, _: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        if commit.only_supersedes_stored_state() {
            self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        Ok(())
    }
}

/// A flag-only publication is projected with its chain but never delivered to
/// after-commit hooks, so no plugin observes it as an update.
#[test]
fn a_flag_only_commit_is_not_delivered_to_after_commit_hooks()
-> Result<(), Box<dyn std::error::Error>> {
    let seen = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(CountPriors(seen.clone()))
        .build()?;
    editor.update(|tx| tx.set_state(NodeKey::ROOT, &META, Arc::new(json!({"version": 10}))))?;
    let mut root = editor.state().view().export_json(NodeKey::ROOT)?;
    root.remove("children");
    if let Some(Value::Object(state)) = root.get_mut("$") {
        state.shift_remove("meta");
    }
    editor.update_with(
        UpdateOptions {
            skip_transforms: true,
            tags: TagSet::from_tags([UpdateTag::Collaboration]),
        },
        |tx| tx.apply_remote_fields_retaining_state(NodeKey::ROOT, &root, &["meta"]),
    )?;
    let (changed, commit) =
        editor.update(|tx| tx.supersede_retained_root_state(&META, &["meta"]))?;
    assert!(changed && commit.only_supersedes_stored_state());
    assert_eq!(seen.load(std::sync::atomic::Ordering::Relaxed), 0);
    Ok(())
}

static OTHER: StateKey<Arc<Value>> = StateKey::new("other", |value| {
    Arc::new(value.cloned().unwrap_or(Value::Null))
});

#[test]
fn a_supersede_is_refused_for_a_key_outside_the_retained_list()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = retained_without_stored_copy()?;
    editor.update(|tx| tx.set_state(NodeKey::ROOT, &OTHER, Arc::new(json!(1))))?;
    for (refused, retained) in [(&OTHER, &["meta"][..]), (&META, &["other"][..])] {
        let result = editor.update(|tx| tx.supersede_retained_root_state(refused, retained));
        assert!(matches!(
            result,
            Err(Error::StoredStateSupersedeRefused { .. })
        ));
    }
    assert_eq!(stored_meta(editor.state()), None);
    Ok(())
}
