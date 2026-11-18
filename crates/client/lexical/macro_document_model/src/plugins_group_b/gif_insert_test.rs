use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};

fn insert(width: f64, height: f64) -> Result<Command, Error> {
    decode_command("group-b.gif-insert", &serde_json::json!({
        "static_file_id":"gif-file", "url":"https://example.test/gif-file", "title":"Gif title", "width":width, "height":height,
    }).to_string(), 0, None)?.ok_or(Error::Invariant("GIF insertion decoder"))
}

#[test]
fn gif_list_midtext_preserves_whole_items_and_selects_the_following_item() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((first, tail), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let first = tx.create(ListItemNode::default())?;
        let tail = tx.create(ListItemNode::default())?;
        let text = tx.create_text("beforeafter")?;
        let last = tx.create_text("tail")?;
        tx.append(first, &[text.key()])?;
        tx.append(tail, &[last.key()])?;
        tx.append(list, &[first.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(text.key(), Utf16Offset(6)),
        ))))?;
        Ok((first.key(), tail.key()))
    })?;
    let (handled, commit) = editor.dispatch(&insert(800.0, 400.0)?)?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    assert_eq!(state.text_content(first), "beforeafter");
    assert_eq!(state.text_content(tail), "tail");
    let root: Vec<_> = state.children(NodeKey::ROOT).collect();
    assert!(state.is::<ListNode>(root[0]));
    let image = state.get_or_err::<ImageNode>(root[1])?;
    assert_eq!(image.media.src_type, Maybe::Value("sfs".into()));
    assert_eq!(image.media.id, Maybe::Value("gif-file".into()));
    assert_eq!(
        image.media.url,
        Maybe::Value("https://example.test/gif-file".into())
    );
    assert_eq!(image.media.width, Maybe::Value(JsNumber(800.0)));
    assert_eq!(image.media.height, Maybe::Value(JsNumber(400.0)));
    assert_eq!(image.media.constrained_width, Maybe::Value(JsNumber(400.0)));
    assert_eq!(
        image.media.constrained_height,
        Maybe::Value(JsNumber(200.0))
    );
    assert_eq!(image.alt, "Gif title");
    assert_eq!(state.parent(tail), Some(root[2]));
    let selection = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert!(selection.is_collapsed());
    assert_eq!(selection.anchor, Point::element(tail, ChildIndex(0)));
    assert_eq!(commit.tags, TagSet::default());
    Ok(())
}

#[test]
fn gif_empty_root_keeps_its_only_paragraph_and_original_caret() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (paragraph, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)?;
        Ok(p.key())
    })?;
    let (handled, _) = editor.dispatch(&insert(800.0, 400.0)?)?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let children: Vec<_> = state.children(NodeKey::ROOT).collect();
    assert_eq!(children.len(), 2);
    assert!(state.is::<ImageNode>(children[0]));
    assert_eq!(children[1], paragraph);
    assert_eq!(
        state
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::element(paragraph, ChildIndex(0))
    );
    Ok(())
}

#[test]
fn gif_node_selection_completes_without_attaching_or_exporting_an_image() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "url".into(),
                url: Some("https://example.test/original.gif".into()),
                ..Default::default()
            },
            None,
        )?;
        tx.append(p, &[image.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let mut selected = NodeSelection::new();
        selected.add(image.key());
        tx.set_selection(Some(Selection::Node(selected)))
    })?;
    let before = editor.state().to_json()?;
    let (handled, _) = editor.dispatch(&insert(800.0, 400.0)?)?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(editor.state().to_json()?, before);
    assert!(!serde_json::to_string(&editor.state().to_json()?)?.contains("gif-file"));
    Ok(())
}

#[test]
fn gif_zero_width_keeps_nan_constraint_and_ordinary_null_export() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (handled, _) = editor.dispatch(&insert(0.0, 20.0)?)?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let image = state
        .descendants(NodeKey::ROOT)
        .find_map(|(key, _)| state.get::<ImageNode>(key))
        .expect("image");
    let Maybe::Value(height) = image.media.constrained_height else {
        panic!("numeric constraint");
    };
    assert!(height.0.is_nan());
    assert!(
        serde_json::to_string(&editor.state().to_json()?)?.contains("\"constrainedHeight\":null")
    );
    Ok(())
}

#[test]
fn gif_payload_requires_typed_values_and_rejects_unknown_fields() {
    for json in [
        "{}",
        r#"["gif-file","https://example.test/gif-file","Gif title",800,400,null]"#,
        r#"{"static_file_id":"gif-file","url":"https://example.test/gif-file","title":"Gif title","width":800,"height":400,"range_style":[1,"color: red;"]}"#,
        r#"{"static_file_id":"gif-file","url":"https://example.test/gif-file","title":"Gif title","width":800,"height":400,"range_style":null}"#,
        r#"{"static_file_id":"f","url":"u","title":"t","width":null,"height":1}"#,
        r#"{"static_file_id":"f","url":"u","title":"t","width":1,"height":1,"extra":true}"#,
    ] {
        assert!(decode_command("group-b.gif-insert", json, 0, None).is_err());
    }
}

#[test]
fn gif_restores_captured_range_style_and_selects_the_following_paragraph() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("beforeafter")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(text.key(), Utf16Offset(6)),
        ))))
    })?;
    let command = decode_command("group-b.gif-insert", &serde_json::json!({
        "static_file_id":"gif-file", "url":"https://example.test/gif-file", "title":"Gif title", "width":800, "height":400,
        "range_style": {"format":1, "style":"color: red;"},
    }).to_string(), 0, None)?.expect("GIF command");
    let (handled, _) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    let selection = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert!(selection.is_collapsed());
    assert!(state.is::<Paragraph>(selection.anchor.key()));
    assert_eq!(state.text_content(selection.anchor.key()), "after");
    assert_eq!(selection.anchor.point_type(), PointType::Element);
    assert_eq!(selection.anchor.offset(), 0);
    assert_eq!(selection.format.bits(), 1);
    assert_eq!(selection.style.as_ref(), "color: red;");
    Ok(())
}
