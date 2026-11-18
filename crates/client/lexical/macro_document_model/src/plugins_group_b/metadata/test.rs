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
fn initial_followups_run_and_the_upgrade_is_a_following_host_update()
-> Result<(), Box<dyn std::error::Error>> {
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
    let (_, edit) = editor.update(|tx| {
        assert!(
            !tx.is_initializing(),
            "ordinary updates must leave initialization"
        );
        let paragraph = tx.first_child(NodeKey::ROOT).expect("paragraph");
        let text = tx.create_text("x")?;
        tx.append(paragraph, &[text.key()])
    })?;
    assert!(
        edit.chain()
            .flat_map(|commit| &commit.events)
            .any(|event| event
                .payload(&DOCUMENT_METADATA_UPGRADE_REQUESTED)
                .is_some()),
        "a mutating edit over stale metadata requests the upgrade"
    );
    assert!(
        editor.state().to_json()?.root["$"]
            .get("documentMetadata")
            .is_none(),
        "the edit's own chain must not write metadata"
    );
    // The host answers in its own following update, like Source's queued microtask.
    let (_, upgrade) = editor.dispatch(&document_metadata_upgrade())?;
    assert!(upgrade.tags.contains(&UpdateTag::HistoryMerge));
    let edited = editor.state().to_json()?;
    assert_eq!(edited.root["$"]["documentMetadata"]["version"], json!(11));
    assert!(
        editor
            .state()
            .view()
            .get_state(NodeKey::ROOT, &CORRECTION)?
    );
    assert_eq!(editor.state().to_json()?, edited);
    Ok(())
}

#[test]
fn initialization_exports_source_canonical_metadata_and_state_order()
-> Result<(), Box<dyn std::error::Error>> {
    for (input, expected) in [
        (
            include_str!("testdata/root-order.input.json"),
            include_str!("testdata/root-order.output.json"),
        ),
        (
            include_str!("testdata/equation-metadata.input.json"),
            include_str!("testdata/equation-metadata.output.json"),
        ),
    ] {
        let editor = crate::surface::preset_builder_with_mode(
            crate::EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .initial_state(serde_json::from_str(input)?)
        .build()?;
        let actual = serde_json::to_value(editor.state().to_json()?)?;
        assert_eq!(lexical_model::to_js_json_string(&actual), expected);
    }
    Ok(())
}

#[test]
fn version_error_follows_root_transforms_not_plain_state_installation()
-> Result<(), Box<dyn std::error::Error>> {
    let state = |version| {
        serde_json::from_value(json!({"root": {
            "type":"root", "version":1,
            "$":{"id":"root0001","documentMetadata":{"version":version,"environmentTags":null}},
            "children":[{"type":"paragraph","version":1,"$":{"id":"para0001"},"children":[
                {"type":"text","version":1,"text":"Before","$":{"id":"leaf0001"}}
            ]}]
        }}))
    };
    let mut editor = crate::surface::preset_builder_with_mode(
        crate::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .initial_state(state(11)?)
    .build()?;
    let future = editor.parse_editor_state(&state(12)?)?;
    let warns = |commit: &Commit| {
        commit
            .chain()
            .flat_map(|item| &item.events)
            .any(|event| event.payload(&VERSION_ERROR).is_some())
    };
    let replaced = editor.set_editor_state(future, TagSet::default())?;
    assert!(
        !warns(&replaced),
        "Source bare setEditorState has no callback"
    );
    let (_, typed) = editor.update(|tx| {
        let paragraph = tx
            .first_child(NodeKey::ROOT)
            .ok_or(Error::Invariant("paragraph"))?;
        let text = tx.first_child(paragraph).ok_or(Error::Invariant("text"))?;
        tx.text(text)?.set_text_content("Before!")?;
        Ok(())
    })?;
    assert!(
        warns(&typed),
        "Source promotes the indirect dirty root after typing"
    );
    let (_, inserted) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])
    })?;
    assert!(
        warns(&inserted),
        "Source top-level insert transforms the root"
    );
    Ok(())
}
