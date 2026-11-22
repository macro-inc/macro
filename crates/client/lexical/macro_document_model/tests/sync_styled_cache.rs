//! Stock Chromium OFF import, attach, metadata update and content-update oracle.
use lexical_loro::{LoroProjection, PlainPolicy, new_doc, reconstruct_state};
use lexical_model::*;
use loro::ExportMode;
use macro_document_model::Result;
use serde_json::Value;

static PROBE: StateKey<String> = StateKey::new("probe", |value| {
    value.and_then(Value::as_str).unwrap_or_default().to_owned()
});
static PLAIN: PlainPolicy = PlainPolicy;

#[test]
fn imported_cache_sequence_and_peer_projection_match_source() -> Result<()> {
    let oracle: Value = serde_json::from_str(include_str!("corpus/styled_cache.json"))?;
    for row in oracle["rows"].as_array().expect("source rows") {
        let mut editor = Editor::builder(EditorMode::ViewAttached)
            .initial_state(serde_json::from_value(row["input"].clone())?)
            .build()?;
        let paragraph = editor
            .state()
            .view()
            .first_child(NodeKey::ROOT)
            .expect("paragraph");
        let data = editor.state().view().element_data(paragraph)?;
        assert_eq!(
            u64::from(data.text_format.bits()),
            row["attached"]["raw"]["textFormat"]
                .as_u64()
                .expect("source format")
        );
        assert_eq!(
            data.text_style.as_ref(),
            row["attached"]["raw"]["textStyle"]
                .as_str()
                .expect("source style")
        );
        assert_eq!(
            serde_json::to_value(editor.state().to_json()?)?,
            row["attached"]["json"]
        );
        let doc = new_doc(97)?;
        let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
        let peer = new_doc(98)?;
        peer.import(&doc.export(ExportMode::Snapshot).expect("actual snapshot"))
            .expect("actual peer import");
        let receiver = Editor::builder(EditorMode::ViewAttached)
            .initial_state(reconstruct_state(&peer, &PLAIN)?)
            .build()?;
        let mut remote = LoroProjection::attach(&peer, receiver.state(), &PLAIN)?;
        let mut core = EditorCore::new(
            receiver,
            CoreConfig {
                history: None,
                editable: true,
                diff: DiffOptions::default(),
                track_text_content: false,
            },
        );
        assert_eq!(core.state().to_json()?, editor.state().to_json()?);
        for (stage, now) in [("afterMetadata", 1), ("afterContent", 2)] {
            let (_, commit) = editor.update(|tx| {
                if stage == "afterMetadata" {
                    tx.set_state(paragraph, &PROBE, "metadata".to_owned())?;
                } else {
                    let first = tx.view().all_text_nodes(NodeKey::ROOT).next();
                    if let Some(key) = first {
                        tx.text(key)?.set_text_content("changed")?;
                    }
                }
                Ok(())
            })?;
            let data = editor.state().view().element_data(paragraph)?;
            assert_eq!(
                u64::from(data.text_format.bits()),
                row[stage]["raw"]["textFormat"]
                    .as_u64()
                    .expect("source format")
            );
            assert_eq!(
                data.text_style.as_ref(),
                row[stage]["raw"]["textStyle"]
                    .as_str()
                    .expect("source style")
            );
            assert_eq!(
                serde_json::to_value(editor.state().to_json()?)?,
                row[stage]["json"]
            );
            projection.local_commit(&doc, &[commit], lexical_loro::LOCAL_ORIGIN, now)?;
            let updates = doc
                .export(ExportMode::updates(&peer.oplog_vv()))
                .expect("actual local operations");
            peer.import(&updates).expect("actual remote import");
            let changes = remote.take_remote(&peer, core.state())?;
            let output = core
                .apply(
                    Input::ApplyRemote {
                        changes: changes.changes.clone(),
                        options: UpdateOptions::default(),
                    },
                    HistoryTime(u64::try_from(now).expect("positive source fixture time")),
                )
                .expect("actual remote core application");
            let created = output
                .effects
                .iter()
                .flat_map(|effect| match effect {
                    Effect::RemoteNodesCreated(pairs) => pairs.clone(),
                    _ => vec![],
                })
                .collect::<Vec<_>>();
            remote.bind_created(changes, &created)?;
            remote.local_commit(&peer, &output.commits, lexical_loro::FIXUP_ORIGIN, now)?;
            assert_eq!(core.state().to_json()?, editor.state().to_json()?);
            remote
                .check(&peer, core.state())
                .expect("actual peer projection");
            assert_eq!(doc.get_deep_value(), peer.get_deep_value());
        }
    }
    Ok(())
}

#[test]
fn content_changing_initial_followup_still_reconciles_writable_caches() -> Result<()> {
    struct ChangeInitialText;
    impl Plugin for ChangeInitialText {
        fn name(&self) -> &'static str {
            "change-initial-text"
        }
        fn commands(&self) -> &[CommandRegistration] {
            &[]
        }
        fn handle(
            &self,
            _: &mut Transaction<'_>,
            _: &Command,
        ) -> std::result::Result<Handled, Error> {
            Ok(Handled::No)
        }
        fn after_commit(
            &self,
            tx: &mut Transaction<'_>,
            commit: &Commit,
        ) -> std::result::Result<(), Error> {
            if commit.changes.mutations.get(&NodeKey::ROOT) == Some(&Mutation::Created) {
                let text = tx
                    .view()
                    .all_text_nodes(NodeKey::ROOT)
                    .next()
                    .expect("actual text");
                tx.text(text)?.set_text_content("authored")?;
            }
            Ok(())
        }
    }
    let oracle: Value = serde_json::from_str(include_str!("corpus/styled_cache.json"))?;
    let row = oracle["rows"]
        .as_array()
        .expect("source rows")
        .iter()
        .find(|row| row["case"] == "styled-paragraph-nested-unstyled-child")
        .expect("source nested case");
    let editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(ChangeInitialText)
        .initial_state(serde_json::from_value(row["input"].clone())?)
        .build()?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output = core
        .take_initial_output()
        .expect("actual initial followup output");
    let first = output
        .commits
        .first()
        .expect("actual initial followup commit");
    let paragraph = first
        .prev
        .view()
        .first_child(NodeKey::ROOT)
        .expect("imported paragraph");
    assert_eq!(
        first.prev.view().element_data(paragraph)?.text_format,
        TextFormat::BOLD
    );
    assert_eq!(
        first
            .prev
            .view()
            .element_data(paragraph)?
            .text_style
            .as_ref(),
        "color: red;"
    );
    assert_eq!(
        core.state().view().element_data(paragraph)?.text_format,
        TextFormat::empty()
    );
    assert_eq!(
        core.state()
            .view()
            .element_data(paragraph)?
            .text_style
            .as_ref(),
        ""
    );
    assert_eq!(core.state().view().text_content(NodeKey::ROOT), "authored");
    Ok(())
}
