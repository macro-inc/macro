//! Application sync exclusions and same-transaction draft preservation.
use lexical_loro::SyncPolicy;
use lexical_model::*;
use macro_document_model::{nodes::*, sync::*, *};
use serde_json::json;

#[test]
fn mirror_null_fields_round_trip_without_changing_plain_json_or_checked_false() {
    for checked in [None, Some(serde_json::Value::Null), Some(json!(false))] {
        let mut item = json!({"type":"listitem","version":1,"value":1,"children":[{"type":"text","version":1,"text":"todo"} ]});
        if let Some(value) = &checked {
            item["checked"] = value.clone();
        }
        let raw = serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[{"type":"task-list","version":1,"tag":"ul","start":1,"listType":if checked == Some(json!(false)) { "check" } else { "bullet" },"children":[item]}]}})).unwrap();
        let mut editor = preset_builder(EditorType::MarkdownSync)
            .initial_state(raw)
            .build()
            .unwrap();
        let plain = lexical_loro::synced_json(editor.state(), &lexical_loro::PlainPolicy).unwrap();
        let expected = if checked == Some(json!(false)) {
            json!(false)
        } else {
            serde_json::Value::Null
        };
        let stored = lexical_loro::synced_json(editor.state(), &MACRO_SYNC_POLICY).unwrap();
        assert_eq!(
            stored.root["children"][0]["children"][0]["checked"],
            expected
        );
        if expected.is_null() {
            assert!(
                !plain.root["children"][0]["children"][0]
                    .as_object()
                    .unwrap()
                    .contains_key("checked")
            );
        }
        let doc = loro::LoroDoc::new();
        doc.set_peer_id(7).unwrap();
        let mut projection =
            lexical_loro::LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)
                .unwrap();
        let (_, commit) = editor
            .update(|tx| {
                let key = tx.view().all_text_nodes(NodeKey::ROOT).next().unwrap();
                tx.text(key)?.set_text_content("edited")?;
                Ok(())
            })
            .unwrap();
        projection
            .local_commit(&doc, &[commit], lexical_loro::LOCAL_ORIGIN, 1)
            .unwrap();
        let remote = loro::LoroDoc::new();
        remote.set_peer_id(8).unwrap();
        remote
            .import(&doc.export(loro::ExportMode::Snapshot).unwrap())
            .unwrap();
        let state = lexical_loro::reconstruct_state(&remote, &MACRO_SYNC_POLICY).unwrap();
        assert_eq!(
            state.root["children"][0]["children"][0]["checked"],
            expected
        );
        let reopened = preset_builder(EditorType::MarkdownSync)
            .initial_state(state)
            .build()
            .unwrap();
        lexical_loro::LoroProjection::attach(&remote, reopened.state(), &MACRO_SYNC_POLICY)
            .unwrap();
        assert_eq!(reopened.state().root_text_content().as_ref(), "edited");
    }
}

#[test]
fn synced_view_keeps_coowners_and_content_but_drops_local_status_and_completion() -> Result<()> {
    let mut editor = export_builder().build()?;
    let raw = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"$":{"id":"p","local":true,"sharedPeerIds":["one","two"],"extra":7},"children":[{"type":"comment-mark","version":1,"ids":["draft"],"isDraft":true,"children":[{"type":"text","version":1,"text":"kept"}]},{"type":"completion","version":1,"text":"local completion"},{"type":"comment-mark","version":1,"ids":["posted"],"isDraft":false,"children":[{"type":"text","version":1,"text":"posted"}]}]}]}}),
    )?;
    let state = editor.parse_editor_state(&raw)?;
    let original = state.to_json()?;
    let synced = synced_json(&state)?;
    let p = &synced["root"]["children"][0];
    assert_eq!(
        p["$"],
        json!({"id":"p","sharedPeerIds":["one","two"],"extra":7})
    );
    assert_eq!(p["children"].as_array().expect("children").len(), 2);
    assert_eq!(p["children"][0]["text"], "kept");
    assert_eq!(p["children"][1]["ids"], json!(["posted"]));
    assert_eq!(state.to_json()?, original);
    assert_eq!(
        MACRO_SYNC_POLICY.ignore_in_remote_compare(
            "image",
            json!({"srcType":"dss"}).as_object().expect("object")
        ),
        &["url"]
    );
    assert!(
        MACRO_SYNC_POLICY
            .ignore_in_remote_compare(
                "video",
                json!({"srcType":"url"}).as_object().expect("object")
            )
            .is_empty()
    );
    assert_eq!(
        MACRO_SYNC_POLICY.keep_local_on_remote("listitem"),
        &["indent"]
    );
    Ok(())
}

#[test]
fn draft_commands_restore_original_identity_and_split_runs_around_remote_content() -> Result<()> {
    let mut editor = preset_builder(EditorType::MarkdownSync).build()?;
    let ((p, mark, first, second), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let mark = create_comment_node(tx, vec!["draft".into()], Maybe::Value(42), Some(true))?;
        let first = tx.create_text("first")?;
        let second = tx.create_text("second")?;
        tx.text(second)?.set_format(TextFormat::BOLD)?;
        tx.append(mark, &[first.key(), second.key()])?;
        tx.append(p, &[mark.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), mark.key(), first.key(), second.key()))
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 1);
    editor.update(|tx| {
        assert_eq!(
            tx.dispatch(&Command::Extension(ExtensionCommand::new(
                &LIFT_DRAFT_COMMENT_MARKS,
                ()
            )))?,
            Handled::Yes
        );
        assert_eq!(tx.children(p).collect::<Vec<_>>(), vec![first, second]);
        let remote = tx.create_text("remote")?;
        tx.insert_before(second, remote, true)?;
        assert_eq!(
            tx.dispatch(&Command::Extension(ExtensionCommand::new(
                &RESTORE_DRAFT_COMMENT_MARKS,
                ()
            )))?,
            Handled::Yes
        );
        assert_eq!(tx.first_child(p), Some(mark));
        assert_eq!(tx.first_child(mark), Some(first));
        let restored = tx.parent(second).expect("new run");
        assert_ne!(restored, mark);
        assert_eq!(
            tx.get_or_err::<CommentNode>(restored)?.thread_id,
            Maybe::Value(42)
        );
        assert_eq!(tx.parent(remote), Some(p));
        Ok(())
    })?;
    assert_eq!(editor.extension::<DraftCommentMarks>()?.count, 2);
    assert!(editor.extension::<DraftCommentMarks>()?.lifted.is_empty());
    Ok(())
}
