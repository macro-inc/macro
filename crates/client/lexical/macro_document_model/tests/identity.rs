//! Durable identity, ownership and rollback follow-up behavior.
use lexical_model::*;
use macro_document_model::{ids::*, peer::*, *};
use serde_json::json;

#[test]
fn id_duplicates_follow_transform_order_and_destroyed_nodes_are_unmapped() -> Result<()> {
    let mut editor =
        NodeIdPlugin::register(export_builder(), &["paragraph", "text"], None, [7; 32]).build()?;
    let ((first, second), _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let id = LexicalNodeId::try_new("duplicate").expect("valid id");
        set_id(tx, first.key(), Some(id.clone()))?;
        set_id(tx, second.key(), Some(id))?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        Ok((first.key(), second.key()))
    })?;
    assert_eq!(
        get_id(editor.state().view(), first)?
            .expect("first id")
            .as_str(),
        "duplicate"
    );
    assert_ne!(
        get_id(editor.state().view(), second)?
            .expect("second id")
            .as_str(),
        "duplicate"
    );
    assert!(get_id(editor.state().view(), NodeKey::ROOT)?.is_none());
    assert_eq!(
        editor
            .extension::<NodeIdState>()?
            .mappings
            .id_to_node_key
            .len(),
        2
    );
    editor.update(|tx| {
        tx.remove(first, false)?;
        tx.remove(second, false)?;
        Ok(())
    })?;
    assert!(
        editor
            .extension::<NodeIdState>()?
            .mappings
            .id_to_node_key
            .is_empty()
    );
    assert!(
        editor
            .extension::<NodeIdState>()?
            .mappings
            .node_key_to_id
            .is_empty()
    );
    Ok(())
}

#[test]
fn failed_transform_rewinds_node_id_entropy_and_mappings() -> Result<()> {
    let mut editor =
        NodeIdPlugin::register(export_builder(), &["paragraph"], None, [4; 32]).build()?;
    let failed = editor.update(|tx| -> ModelResult<()> {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.flush()?;
        Err(lexical_model::Error::Invariant("abort after id transform"))
    });
    assert!(failed.is_err());
    assert!(
        editor
            .extension::<NodeIdState>()?
            .mappings
            .id_to_node_key
            .is_empty()
    );
    let mut clean =
        NodeIdPlugin::register(export_builder(), &["paragraph"], None, [4; 32]).build()?;
    for editor in [&mut editor, &mut clean] {
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            Ok(())
        })?;
    }
    assert_eq!(editor.state().to_json()?, clean.state().to_json()?);
    Ok(())
}

#[test]
fn initial_peer_hook_resolves_local_and_remote_owner_changes_recompute_it() -> Result<()> {
    let mut parser = export_builder().build()?;
    let loaded = parser.parse_editor_state(&serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[{"type":"comment-mark","version":1,"ids":["m"],"isDraft":false,"$":{"peerId":"one"},"children":[{"type":"text","version":1,"text":"text"}]}]}}))?)?;
    let mut editor = PeerIdPlugin::register(
        export_builder(),
        &["comment-mark"],
        PeerIdState {
            peer_id: Some("one".into()),
        },
    )
    .initial_state(loaded.to_json()?)
    .build()?;
    let key = editor
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("mark");
    assert_eq!(get_local(editor.state().view(), key)?, Some(true));
    let (_, commit) = editor.update_with(
        UpdateOptions {
            tags: {
                let mut tags = TagSet::default();
                tags.insert(UpdateTag::Custom("from-loro".into()));
                tags
            },
            ..Default::default()
        },
        |tx| set_peer_id(tx, key, "two".into()),
    )?;
    assert_eq!(get_local(editor.state().view(), key)?, Some(false));
    assert!(commit.chain().any(|commit| {
        commit
            .tags
            .iter()
            .any(|tag| tag.to_string() == "local-status")
    }));
    Ok(())
}

#[test]
fn peer_truthiness_coownership_promotion_and_root_noop_match_source() -> Result<()> {
    let mut editor = export_builder().build()?;
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        set_peer_id(tx, p.key(), String::new())?;
        add_shared_peer(tx, p.key(), "second")?;
        assert!(get_shared_peers(tx.view(), p.key())?.is_none());
        assert!(!peer_id_valid(
            PeerIdTarget::Node(tx.view(), p.key()),
            Some("one")
        )?);
        assert!(peer_id_valid(
            PeerIdTarget::Node(tx.view(), p.key()),
            Some("")
        )?);
        assert!(!peer_id_valid(
            PeerIdTarget::Serialized(&json!({"$":{"peerId":2}})),
            Some("one")
        )?);
        set_peer_id(tx, p.key(), "one".into())?;
        update_all_ownership(tx, Some("one"), None)?;
        assert_eq!(get_local(tx.view(), p.key())?, None);
        add_shared_peer(tx, p.key(), "second")?;
        add_shared_peer(tx, p.key(), "second")?;
        add_shared_peer(tx, p.key(), "third")?;
        assert!(!remove_peer_id(tx, p.key(), "one")?);
        assert_eq!(get_peer_id(tx.view(), p.key())?.as_deref(), Some("second"));
        assert_eq!(
            get_shared_peers(tx.view(), p.key())?
                .expect("remaining")
                .as_ref(),
            &["third".to_owned()]
        );
        assert!(!remove_peer_id(tx, p.key(), "third")?);
        assert!(remove_peer_id(tx, p.key(), "second")?);
        assert_eq!(get_local(tx.view(), p.key())?, None);
        Ok(())
    })?;
    Ok(())
}

#[test]
fn loaded_ids_and_stored_highlights_survive_initial_hooks_and_clipboard_clears_recursively()
-> Result<()> {
    use lexical_rich_nodes::code::CodeHighlightNode;
    use macro_document_model::nodes::*;
    let raw = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"$":{"id":"root"},"children":[{"type":"paragraph","version":1,"$":{"id":"paragraph"},"children":[{"type":"code-highlight","version":1,"text":"let","format":0,"style":"","mode":"normal","detail":0,"highlightType":"keyword","$":{"id":"stored-highlight","extra":7}}]}]}}),
    )?;
    let mut editor = NodeIdPlugin::register(
        export_builder(),
        &["paragraph", "code-highlight"],
        None,
        [8; 32],
    )
    .initial_state(raw)
    .build()?;
    let view = editor.state().view();
    let paragraph = view.first_child(NodeKey::ROOT).expect("paragraph");
    let highlight = view.first_child(paragraph).expect("highlight");
    assert!(view.is::<CodeHighlightNode>(highlight));
    assert_eq!(
        get_id(view, NodeKey::ROOT)?.expect("root id").as_str(),
        "root"
    );
    assert_eq!(
        get_id(view, paragraph)?.expect("loaded id").as_str(),
        "paragraph"
    );
    assert_eq!(
        get_id(view, highlight)?.expect("stored id").as_str(),
        "stored-highlight"
    );
    editor.update(|tx| {
        tx.mark_dirty(highlight)?;
        let comment = create_comment_node(tx, vec!["mark".into()], Maybe::Missing, None)?;
        tx.append(paragraph, &[comment.key()])?;
        Ok(())
    })?;
    assert!(editor.state().view().is::<CodeHighlightNode>(highlight));
    assert_eq!(
        get_id(editor.state().view(), highlight)?
            .expect("stable highlight")
            .as_str(),
        "stored-highlight"
    );
    editor.update(|tx| {
        prepare_clipboard_nodes(tx, &[paragraph])?;
        assert!(get_id(tx.view(), paragraph)?.is_none());
        assert!(get_id(tx.view(), highlight)?.is_none());
        Ok(())
    })?;
    assert_ne!(
        get_id(editor.state().view(), paragraph)?
            .expect("fresh paragraph")
            .as_str(),
        "paragraph"
    );
    assert_ne!(
        get_id(editor.state().view(), highlight)?
            .expect("fresh highlight")
            .as_str(),
        "stored-highlight"
    );
    Ok(())
}

#[test]
fn clipboard_invalidation_runs_before_lower_handlers_without_consuming_insert() -> Result<()> {
    struct Insert;
    impl Plugin for Insert {
        fn name(&self) -> &'static str {
            "clipboard-insert"
        }
        fn commands(&self) -> &[CommandRegistration] {
            const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
                command: CommandKind::InsertClipboardNodes,
                priority: CommandPriority::Normal,
                placement: Placement::After,
            }];
            COMMANDS
        }
        fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> ModelResult<Handled> {
            if let Command::InsertClipboardNodes { nodes, .. } = command {
                for node in nodes {
                    assert!(get_id(tx.view(), *node)?.is_none());
                }
                tx.append(NodeKey::ROOT, nodes)?;
                return Ok(Handled::Yes);
            }
            Ok(Handled::No)
        }
    }
    let mut editor = NodeIdPlugin::register(export_builder(), &["paragraph"], None, [9; 32])
        .plugin(Insert)
        .build()?;
    let (pasted, _) = editor.update(|tx| {
        let pasted = tx.create(Paragraph::default())?;
        set_id(
            tx,
            pasted.key(),
            Some(LexicalNodeId::try_new("clipboard-id").expect("id")),
        )?;
        assert_eq!(
            tx.dispatch(&Command::InsertClipboardNodes {
                nodes: vec![pasted.key()],
                selection: SelectionSlot::Active
            })?,
            Handled::Yes
        );
        Ok(pasted.key())
    })?;
    assert!(editor.state().view().is_attached(pasted));
    assert_ne!(
        get_id(editor.state().view(), pasted)?
            .expect("fresh pasted id")
            .as_str(),
        "clipboard-id"
    );
    Ok(())
}

#[test]
fn empty_current_peer_disables_transforms_and_bulk_ownership_but_empty_id_regenerates() -> Result<()>
{
    let mut editor = PeerIdPlugin::register(
        export_builder(),
        &["paragraph"],
        PeerIdState {
            peer_id: Some(String::new()),
        },
    )
    .extension_state(NodeRandom(std::sync::Arc::new(|size| vec![0; size])))
    .build()?;
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_state(p, &ID_STATE, Some(String::new()))?;
        assert_eq!(assert_id(tx, p.key(), 8)?.as_str(), "uuuuuuuu");
        Ok(p.key())
    })?;
    assert_eq!(get_peer_id(editor.state().view(), p)?, None);
    assert_eq!(get_local(editor.state().view(), p)?, None);
    editor.update(|tx| {
        set_peer_id(tx, p, "owner".into())?;
        update_all_ownership(tx, Some(""), Some(p))?;
        assert_eq!(get_local(tx.view(), p)?, None);
        Ok(())
    })?;
    Ok(())
}

#[test]
fn imported_code_keeps_the_canonical_id_key_and_rejects_distinct_same_name_keys() -> Result<()> {
    static OTHER_OPTION_ID: StateKey<Option<String>> = StateKey::new("id", |value| {
        value.and_then(serde_json::Value::as_str).map(str::to_owned)
    });
    static OTHER_STRING_ID: StateKey<String> = StateKey::new("id", |value| {
        value
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned()
    });
    let state = serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[{
        "type":"custom-code","version":1,"language":"javascript","$":{"id":"persisted-code"},
        "children":[{"type":"text","version":1,"text":"const persistenceCode = 1;"}]
    }]}}))?;
    let editor = export_builder().initial_state(state).build()?;
    let view = editor.state().view();
    let code = view.first_child(NodeKey::ROOT).expect("code");
    assert_eq!(
        view.get_state(code, &ID_STATE)?,
        Some("persisted-code".into())
    );
    assert!(matches!(
        view.get_state(code, &OTHER_OPTION_ID),
        Err(lexical_model::Error::StateKeyCollision { key: "id" })
    ));
    assert!(matches!(
        view.get_state(code, &OTHER_STRING_ID),
        Err(lexical_model::Error::StateKeyCollision { key: "id" })
    ));
    let saved = editor.state().to_json()?;
    let loaded = export_builder().initial_state(saved.clone()).build()?;
    assert_eq!(loaded.state().to_json()?, saved);
    Ok(())
}
