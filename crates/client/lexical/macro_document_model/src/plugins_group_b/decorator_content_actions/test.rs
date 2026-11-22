use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;

fn editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .extension_state(crate::NodeClock(std::sync::Arc::new(|| 1234)))
        .build()
        .expect("surface")
}
fn command(key: NodeKey, action: &str, extra: serde_json::Value) -> Result<Command, Error> {
    let mut json = serde_json::json!({"key":key.index(),"action":action});
    if let (Some(target), Some(extra)) = (json.as_object_mut(), extra.as_object()) {
        target.extend(extra.clone());
    }
    Ok(decode_command(
        "group-b.document-mention",
        &json.to_string(),
        key.generation(),
        None,
    )?
    .expect("document action"))
}
fn seed(editor: &mut Editor) -> Result<(Id<DocumentMentionNode>, NodeKey, NodeKey), Error> {
    let (ids, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let before = tx.create_text("before ")?;
        let mention = tx.create(DocumentMentionNode {
            document_id: Maybe::Value("target".into()),
            document_name: Maybe::Value("Old".into()),
            block_name: Maybe::Value("task".into()),
            mention_uuid: Maybe::Value("mention".into()),
            ..Default::default()
        })?;
        let after = tx.create_text(" after")?;
        tx.append(p, &[before.key(), mention.key(), after.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((mention, before.key(), after.key()))
    })?;
    Ok(ids)
}
#[test]
fn collapse_changes_only_typed_mention_payload_and_signature() -> Result<(), Error> {
    let mut editor = editor();
    let (mention, before, after) = seed(&mut editor)?;
    let original = editor
        .state()
        .view()
        .get_or_err::<DocumentMentionNode>(mention)?
        .clone();
    let signature = original.render_signature()?;
    assert_eq!(
        editor
            .dispatch(&command(
                mention.key(),
                "collapse",
                serde_json::json!({"collapsed":true})
            )?)?
            .0,
        Handled::Yes
    );
    let node = editor
        .state()
        .view()
        .get_or_err::<DocumentMentionNode>(mention)?;
    let mut expected = original.clone();
    expected.collapsed = true;
    assert_eq!(node, &expected);
    assert_ne!(node.render_signature()?, signature);
    assert_eq!(
        editor
            .dispatch(&command(
                mention.key(),
                "collapse",
                serde_json::json!({"collapsed":false})
            )?)?
            .0,
        Handled::Yes
    );
    assert_eq!(
        editor
            .state()
            .view()
            .get_or_err::<DocumentMentionNode>(mention)?
            .render_signature()?,
        signature
    );
    assert!(editor.state().view().node(before).is_some());
    assert!(editor.state().view().node(after).is_some());
    Ok(())
}
#[test]
fn text_conversion_uses_plain_text_and_preserves_adjacent_content() -> Result<(), Error> {
    let mut editor = editor();
    let (mention, _, _) = seed(&mut editor)?;
    let paragraph = editor.state().view().parent(mention).expect("parent");
    assert_eq!(
        editor
            .dispatch(&command(
                mention.key(),
                "to-text",
                serde_json::json!({"text":"https://example.com/item"})
            )?)?
            .0,
        Handled::Yes
    );
    assert!(editor.state().view().node(mention).is_none());
    assert_eq!(
        editor.state().view().text_content(paragraph),
        "before https://example.com/item after"
    );
    Ok(())
}
#[test]
fn deletion_removes_only_actual_mention_and_keeps_surrounding_content() -> Result<(), Error> {
    let mut editor = editor();
    let (mention, _, _) = seed(&mut editor)?;
    let paragraph = editor.state().view().parent(mention).expect("parent");
    assert_eq!(
        editor
            .dispatch(&command(mention.key(), "remove", serde_json::json!({}))?)?
            .0,
        Handled::Yes
    );
    assert!(editor.state().view().node(mention).is_none());
    assert_eq!(
        editor.state().view().text_content(paragraph),
        "before  after"
    );
    Ok(())
}
#[test]
fn card_conversion_reuses_model_split_and_reference_copy() -> Result<(), Error> {
    let mut editor = editor();
    let (mention, _, _) = seed(&mut editor)?;
    assert_eq!(
        editor
            .dispatch(&command(mention.key(), "to-card", serde_json::json!({}))?)?
            .0,
        Handled::Yes
    );
    let view = editor.state().view();
    assert!(view.node(mention).is_none());
    let cards: Vec<_> = view
        .descendants(NodeKey::ROOT)
        .filter_map(|(key, _)| view.get::<DocumentCardNode>(key))
        .collect();
    assert_eq!(cards.len(), 1);
    let card = cards[0];
    assert_eq!(card.document_id, Maybe::Value("target".into()));
    assert_eq!(card.document_name, Maybe::Value("Old".into()));
    assert_eq!(card.mention_uuid, Maybe::Value("mention".into()));
    assert_eq!(card.preview_data, Maybe::Missing);
    assert_eq!(view.children(NodeKey::ROOT).count(), 3);
    Ok(())
}
#[test]
fn wrong_types_and_stale_keys_yield_for_every_mention_action() -> Result<(), Error> {
    let mut editor = editor();
    let (mention, text, _) = seed(&mut editor)?;
    let stale = NodeKey::from_parts(KeyParts {
        index: mention.key().index(),
        generation: mention.key().generation() + 1,
    });
    let before = editor.state().to_json()?;
    for key in [text, stale] {
        for (action, extra) in [
            ("remove", serde_json::json!({})),
            ("to-card", serde_json::json!({})),
            ("to-text", serde_json::json!({"text":""})),
            ("collapse", serde_json::json!({"collapsed":true})),
        ] {
            assert_eq!(
                editor.dispatch(&command(key, action, extra)?)?.0,
                Handled::No
            );
        }
    }
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}
#[test]
fn network_names_update_mentions_and_cards_with_source_truthiness_and_tags() -> Result<(), Error> {
    let mut editor = editor();
    let (mention, _, _) = seed(&mut editor)?;
    let ((card, detached), _) = editor.update(|tx| {
        let card = tx.create(DocumentCardNode {
            document_id: Maybe::Value("target".into()),
            document_name: Maybe::Value("Old card".into()),
            ..Default::default()
        })?;
        tx.append(NodeKey::ROOT, &[card.key()])?;
        let detached = tx.create(DocumentMentionNode {
            document_id: Maybe::Value("target".into()),
            document_name: Maybe::Value("Detached".into()),
            ..Default::default()
        })?;
        Ok((card, detached))
    })?;
    let command = decode_command(
        "group-b.document-names",
        r#"{"names":{"target":" "}}"#,
        mention.key().generation(),
        None,
    )?
    .expect("names");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.tags.contains(&UpdateTag::Historic));
    assert!(commit.tags.contains(&UpdateTag::SkipDomSelection));
    assert!(commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    assert_eq!(
        editor
            .state()
            .view()
            .get_or_err::<DocumentMentionNode>(mention)?
            .document_name,
        Maybe::Value(" ".into())
    );
    assert_eq!(
        editor
            .state()
            .view()
            .get_or_err::<DocumentCardNode>(card)?
            .document_name,
        Maybe::Value(" ".into())
    );
    assert!(
        editor
            .state()
            .view()
            .get::<DocumentMentionNode>(detached)
            .is_none()
    );
    let command = decode_command(
        "group-b.document-names",
        r#"{"names":{"target":""}}"#,
        mention.key().generation(),
        None,
    )?
    .expect("names");
    editor.dispatch(&command)?;
    assert_eq!(
        editor
            .state()
            .view()
            .get_or_err::<DocumentMentionNode>(mention)?
            .document_name,
        Maybe::Value(" ".into())
    );
    Ok(())
}

fn card_command(key: NodeKey, action: &str, fields: serde_json::Value) -> Result<Command, Error> {
    let mut data = serde_json::json!({"key":key.index(),"action":action});
    if let (Some(data), Some(fields)) = (data.as_object_mut(), fields.as_object()) {
        data.extend(fields.clone());
    }
    Ok(decode_command(
        "group-b.document-card",
        &data.to_string(),
        key.generation(),
        None,
    )?
    .expect("card command"))
}
fn seed_card(editor: &mut Editor) -> Result<Id<DocumentCardNode>, Error> {
    let (card, _) = editor.update(|tx| {
        let card = tx.create(DocumentCardNode {
            document_id: Maybe::Value("target".into()),
            document_name: Maybe::Value("Card".into()),
            block_name: Maybe::Value("md".into()),
            mention_uuid: Maybe::Value("reference".into()),
            ..Default::default()
        })?;
        tx.append(NodeKey::ROOT, &[card.key()])?;
        Ok(card)
    })?;
    Ok(card)
}
#[test]
fn card_converts_to_a_paragraph_mention_using_the_real_clock_and_optional_select_end()
-> Result<(), Error> {
    for select_end in [false, true] {
        let mut editor = editor();
        let card = seed_card(&mut editor)?;
        let (handled, _) = editor.dispatch(&card_command(
            card.key(),
            "to-mention",
            serde_json::json!({"selectEnd":select_end}),
        )?)?;
        assert_eq!(handled, Handled::Yes);
        let view = editor.state().view();
        assert!(view.node(card).is_none());
        let mentions: Vec<_> = view
            .descendants(NodeKey::ROOT)
            .filter_map(|(key, _)| view.cast::<DocumentMentionNode>(key))
            .collect();
        assert_eq!(mentions.len(), 1);
        let mention = mentions[0];
        let data = view.get_or_err::<DocumentMentionNode>(mention)?;
        assert_eq!(data.document_id, Maybe::Value("target".into()));
        assert_eq!(data.mention_uuid, Maybe::Value("reference".into()));
        assert_eq!(data.created_at, Maybe::Value(1234));
        assert!(!data.collapsed);
        assert!(
            view.parent(mention)
                .is_some_and(|key| view.is::<Paragraph>(key))
        );
        if select_end {
            let range = editor
                .state()
                .selection()
                .and_then(Selection::as_range)
                .expect("selected range");
            assert_eq!(range.anchor, range.focus);
            assert_eq!(range.anchor.key(), view.parent(mention).expect("paragraph"));
            assert_eq!(range.anchor.offset(), 1);
        }
    }
    Ok(())
}
#[test]
fn card_height_data_box_and_database_location_keep_source_tags() -> Result<(), Error> {
    let mut editor = editor();
    let card = seed_card(&mut editor)?;
    let (_, height) = editor.dispatch(&card_command(
        card.key(),
        "preview-height",
        serde_json::json!({"height":"52%"}),
    )?)?;
    assert!(height.tags.contains(&UpdateTag::HistoryMerge));
    let view = editor.state().view();
    let node = view.get_or_err::<DocumentCardNode>(card)?;
    assert_eq!(node.preview_box[0], PreviewDim::Str("100%".into()));
    assert_eq!(node.preview_box[1], PreviewDim::Str("52%".into()));
    let (_, data) = editor.dispatch(&card_command(
        card.key(),
        "preview-data",
        serde_json::json!({"data":{"view":{"x":3,"y":-2,"scale":1.25}}}),
    )?)?;
    assert!(data.tags.contains(&UpdateTag::HistoryMerge));
    assert_eq!(
        editor
            .state()
            .view()
            .get_or_err::<DocumentCardNode>(card)?
            .preview_data,
        Maybe::Value(serde_json::json!({"view":{"x":3,"y":-2,"scale":1.25}}))
    );
    let (_, box_commit) = editor.dispatch(&card_command(
        card.key(),
        "preview-box",
        serde_json::json!({"previewBox":[360,240]}),
    )?)?;
    assert!(!box_commit.tags.contains(&UpdateTag::HistoryMerge));
    let (_, params) = editor.dispatch(&card_command(
        card.key(),
        "block-params",
        serde_json::json!({"params":{"view":"view-b","table":"table-a"}}),
    )?)?;
    assert!(params.tags.contains(&UpdateTag::SkipDomSelection));
    assert!(!params.tags.contains(&UpdateTag::HistoryMerge));
    Ok(())
}
#[test]
fn stale_card_background_callbacks_retain_their_update_tags_without_mutating_wrong_nodes()
-> Result<(), Error> {
    let mut editor = editor();
    let (_, text, _) = seed(&mut editor)?;
    let before = editor.state().to_json()?;
    for (action, fields, tag) in [
        (
            "preview-height",
            serde_json::json!({"height":"100px"}),
            UpdateTag::HistoryMerge,
        ),
        (
            "preview-data",
            serde_json::json!({"data":{"view":{"x":1,"y":2,"scale":1}}}),
            UpdateTag::HistoryMerge,
        ),
        (
            "block-params",
            serde_json::json!({"params":{}}),
            UpdateTag::SkipDomSelection,
        ),
    ] {
        let (handled, commit) = editor.dispatch(&card_command(text, action, fields)?)?;
        assert_eq!(handled, Handled::No);
        assert!(commit.tags.contains(&tag));
        assert_eq!(editor.state().to_json()?, before);
    }
    Ok(())
}
#[test]
fn card_delete_uses_the_shared_typed_selection_restoration() -> Result<(), Error> {
    let mut editor = editor();
    let card = seed_card(&mut editor)?;
    assert_eq!(
        editor
            .dispatch(&card_command(card.key(), "remove", serde_json::json!({}))?)?
            .0,
        Handled::Yes
    );
    let view = editor.state().view();
    assert!(view.node(card).is_none());
    let first = view
        .children(NodeKey::ROOT)
        .next()
        .expect("empty paragraph");
    assert!(view.is::<Paragraph>(first));
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::element(first, ChildIndex(0))
    );
    Ok(())
}
#[test]
fn durable_card_id_query_is_current_typed_generation_checked_and_read_only() -> Result<(), Error> {
    let mut editor = editor();
    let card = seed_card(&mut editor)?;
    editor.update(|tx| tx.set_state(card, &crate::node_ids::ID_STATE, Some("card-one".into())))?;
    let before = editor.state().to_json()?;
    let query = |generation, state: &EditorState| {
        super::query(
            "group-b.document-card-id",
            &serde_json::json!({"key":card.key().index()}),
            generation,
            state,
        )
    };
    assert_eq!(
        query(card.key().generation(), editor.state())?,
        Some(serde_json::json!("card-one"))
    );
    assert_eq!(editor.state().to_json()?, before);
    editor.update(|tx| tx.set_state(card, &crate::node_ids::ID_STATE, Some("card-two".into())))?;
    assert_eq!(
        query(card.key().generation(), editor.state())?,
        Some(serde_json::json!("card-two"))
    );
    assert_eq!(
        query(card.key().generation() + 1, editor.state())?,
        Some(serde_json::Value::Null)
    );
    assert_eq!(
        super::query(
            "other.query",
            &serde_json::Value::Null,
            card.key().generation(),
            editor.state()
        )?,
        None
    );
    Ok(())
}
#[test]
fn database_params_do_not_change_cached_signature_but_ordered_own_props_still_reach_the_view()
-> Result<(), Error> {
    let mut editor = editor();
    let card = seed_card(&mut editor)?;
    editor.update(|tx| {
        let mut card = tx.get_mut::<DocumentCardNode>(card)?;
        card.block_name = Maybe::Value("database".into());
        card.block_params.insert("first".into(), "1".into());
        card.block_params.insert("second".into(), "2".into());
        Ok(())
    })?;
    let signature = editor
        .state()
        .view()
        .get_or_err::<DocumentCardNode>(card)?
        .render_signature()?;
    let (_, commit) = editor.dispatch(&card_command(
        card.key(),
        "block-params",
        serde_json::json!({"params":{"second":"2","first":"1"}}),
    )?)?;
    assert_eq!(
        editor
            .state()
            .view()
            .get_or_err::<DocumentCardNode>(card)?
            .render_signature()?,
        signature
    );
    let diff = commit.diff(&DiffOptions::default())?;
    let props = diff
        .ops
        .iter()
        .find_map(|op| match op {
            DiffOp::NodeProps { key, props } if *key == card.key() => Some(props),
            _ => None,
        })
        .expect("ordered database property update");
    let params = props
        .get("blockParams")
        .and_then(serde_json::Value::as_object)
        .expect("params");
    assert_eq!(
        params.keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["second", "first"]
    );
    Ok(())
}
