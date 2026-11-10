use super::*;

static CORRECTION: StateKey<bool> = StateKey::new("initialCorrection", |value| {
    value.and_then(Value::as_bool).unwrap_or(false)
});

struct InitialCorrection;
impl Plugin for InitialCorrection {
    fn name(&self) -> &'static str {
        "initial-correction"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        if !tx.get_state(NodeKey::ROOT, &CORRECTION)? {
            assert!(
                tx.is_initializing(),
                "the correction must run during initialization"
            );
            tx.set_state(NodeKey::ROOT, &CORRECTION, true)?;
        }
        Ok(())
    }
}

#[test]
fn initial_followups_still_run_without_upgrading_metadata() -> Result<(), Box<dyn std::error::Error>>
{
    let mut editor = register(Editor::builder(EditorMode::ViewAttached))
        .plugin(InitialCorrection)
        .initial_state(serde_json::from_value(json!({
            "root": { "type": "root", "version": 1, "children": [
                { "type": "paragraph", "version": 1, "children": [] }
            ] }
        }))?)
        .build()?;
    assert!(
        editor
            .state()
            .view()
            .get_state(NodeKey::ROOT, &CORRECTION)?
    );
    let initial = editor.state().to_json()?;
    assert!(
        initial
            .root
            .get("$")
            .and_then(|state| state.get("documentMetadata"))
            .is_none()
    );
    editor.update(|tx| {
        assert!(
            !tx.is_initializing(),
            "ordinary updates must leave initialization"
        );
        let paragraph = tx.first_child(NodeKey::ROOT).expect("paragraph");
        let text = tx.create_text("x")?;
        tx.append(paragraph, &[text.key()])
    })?;
    let edited = editor.state().to_json()?;
    assert_eq!(edited.root["$"]["documentMetadata"]["version"], json!(10));
    assert!(
        editor
            .state()
            .view()
            .get_state(NodeKey::ROOT, &CORRECTION)?
    );
    assert_eq!(editor.state().to_json()?, edited);
    Ok(())
}
