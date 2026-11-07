use super::*;
use serde_json::json;
/// upstream: LexicalLinkNode.test.ts, toggleLink applies title on creation.
#[test]
fn selected_text_becomes_link_with_literal_attributes() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("label")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(5)))?;
    toggle_link(
        &mut tx,
        Some("/target"),
        ToggleLinkAttributes {
            title: AttrUpdate::Value("title".into()),
            ..Default::default()
        },
    )?;
    tx.commit()?;
    assert_eq!(
        serde_json::to_value(editor.state().to_json()?)?,
        json!({"root":{"children":[{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"label","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"link","version":1,"rel":"noreferrer","target":null,"title":"title","url":"/target"}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1}})
    );
    Ok(())
}

/// upstream: LexicalLinkNode.test.ts, toggleLink removes leading selection.
#[test]
fn unlink_leading_selection_splits_only_the_selected_span() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_link_node(&mut tx, "/url", LinkAttributes::default())?;
    let text = tx.create_text(" abc ")?;
    tx.append(link, &[text.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(1)))?;
    toggle_link(&mut tx, None, ToggleLinkAttributes::default())?;
    assert_eq!(tx.children_size(p), 2);
    assert_eq!(tx.text_content(p), " abc ");
    Ok(())
}

/// upstream: LexicalLinkNode.test.ts, toggleLink removes middle selection.
#[test]
fn unlink_middle_selection_splits_only_the_selected_span() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_link_node(&mut tx, "/url", LinkAttributes::default())?;
    let text = tx.create_text(" abc ")?;
    tx.append(link, &[text.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(4)))?;
    toggle_link(&mut tx, None, ToggleLinkAttributes::default())?;
    assert_eq!(tx.children_size(p), 3);
    assert_eq!(tx.text_content(p), " abc ");
    Ok(())
}

/// upstream: LexicalLinkNode.test.ts, toggleLink removes trailing selection.
#[test]
fn unlink_trailing_selection_splits_only_the_selected_span() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_link_node(&mut tx, "/url", LinkAttributes::default())?;
    let text = tx.create_text(" abc ")?;
    tx.append(link, &[text.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(4)), Some(Utf16Offset(5)))?;
    toggle_link(&mut tx, None, ToggleLinkAttributes::default())?;
    assert_eq!(tx.children_size(p), 2);
    assert_eq!(tx.text_content(p), " abc ");
    Ok(())
}

/// upstream: LexicalLinkNode.test.ts, toggleLink removes collapsed selection.
#[test]
fn unlink_collapsed_selection_splits_only_the_selected_span() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_link_node(&mut tx, "/url", LinkAttributes::default())?;
    let text = tx.create_text(" abc ")?;
    tx.append(link, &[text.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    toggle_link(&mut tx, None, ToggleLinkAttributes::default())?;
    assert_eq!(tx.children_size(p), 1);
    assert_eq!(tx.text_content(p), " abc ");
    Ok(())
}

/// upstream: LexicalLinkExtension, explicit payload fields replace configured defaults.
#[test]
fn command_validation_and_payload_attribute_precedence() -> Result<()> {
    let config = LinkConfig {
        validate_url: Some(Arc::new(|url| url.starts_with("https:"))),
        attributes: Some(LinkAttributes {
            rel: Some("noopener".into()),
            target: Some("_blank".into()),
            title: Some("default".into()),
        }),
    };
    let mut editor = register_link(Editor::builder(EditorMode::Headless), config.clone())
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("label")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(5)))?;
    assert!(!handle_toggle_link_command(
        &mut tx,
        &ToggleLinkPayload::Url("/rejected".into()),
        &config
    )?);
    assert_eq!(tx.first_child(p), Some(text.key()));
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &TOGGLE_LINK,
            ToggleLinkPayload::Attributes {
                url: Some("/explicit".into()),
                attributes: ToggleLinkAttributes::default()
            }
        )))?,
        Handled::Yes
    );
    let link = tx.first_child_or_err(p)?;
    let payload = tx.get::<LinkNode>(link).expect("link");
    assert_eq!(payload.url, "/explicit");
    assert_eq!(payload.rel.as_deref(), Some("noreferrer"));
    assert_eq!(payload.target, None);
    assert_eq!(payload.title, None);
    toggle_link(
        &mut tx,
        Some("/updated"),
        ToggleLinkAttributes {
            rel: AttrUpdate::Null,
            target: AttrUpdate::Value("".into()),
            title: AttrUpdate::Value("new".into()),
        },
    )?;
    let payload = tx.get::<LinkNode>(link).expect("link");
    assert_eq!(payload.rel, None);
    assert_eq!(payload.target.as_deref(), Some(""));
    assert_eq!(payload.title.as_deref(), Some("new"));
    assert!(handle_toggle_link_command(
        &mut tx,
        &ToggleLinkPayload::Remove,
        &config
    )?);
    assert_eq!(tx.first_child(p), Some(text.key()));
    Ok(())
}
/// upstream: LexicalLinkExtension, URL paste needs configured validation and a range of leaves.
#[test]
fn paste_link_validation_requires_noncollapsed_range() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("label")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let config = LinkConfig {
        validate_url: Some(Arc::new(|url| url == "https://example.com")),
        attributes: None,
    };
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    assert!(!paste_url_as_link(&mut tx, "https://example.com", &config)?);
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(5)))?;
    assert!(!paste_url_as_link(
        &mut tx,
        "https://rejected.invalid",
        &config
    )?);
    assert!(paste_url_as_link(&mut tx, "https://example.com", &config)?);
    assert!(tx.is::<LinkNode>(tx.first_child_or_err(p)?));
    Ok(())
}
/// upstream: toggleLink NodeSelection updates target/rel and ignores title.
#[test]
fn node_selection_wrap_and_unwrap_ignores_title() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("label")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut selection = NodeSelection::new();
    selection.add(text);
    tx.set_selection(Some(Selection::Node(selection)))?;
    toggle_link(
        &mut tx,
        Some("/url"),
        ToggleLinkAttributes {
            title: AttrUpdate::Value("ignored".into()),
            ..Default::default()
        },
    )?;
    let link = tx.first_child_or_err(p)?;
    assert_eq!(tx.get::<LinkNode>(link).expect("link").title, None);
    toggle_link(&mut tx, None, ToggleLinkAttributes::default())?;
    assert_eq!(tx.children_keys(p)?, vec![text.key()]);
    Ok(())
}

#[test]
fn wrapping_line_break_restores_only_the_captured_focus_endpoint() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let line = tx.create(LineBreak::default())?;
    tx.append(paragraph, &[line.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.select_end(line)?;
    toggle_link(&mut tx, Some("/"), Default::default())?;
    let link = tx.children_keys(paragraph)?[0];
    let range = tx.selection().and_then(Selection::as_range).expect("range");
    assert_eq!(range.anchor, Point::element(paragraph, ChildIndex(2)));
    assert_eq!(range.focus, Point::element(link, ChildIndex(1)));
    assert!(range.is_backward(tx.view())?);
    Ok(())
}

#[test]
fn unlink_rejects_an_empty_extracted_edge_of_a_nonempty_link() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .build()
        .expect("editor");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let before = tx.create_text("a")?;
        let link = create_link_node(tx, "/", LinkAttributes::default())?;
        let text = tx.create_text("link")?;
        tx.append(link, &[text.key()])?;
        tx.append(paragraph, &[before.key(), link.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(before, Utf16Offset(0)),
            Point::text(text, Utf16Offset(0)),
        ))))
    })?;
    let previous = editor.state().to_json()?;
    let result = editor.update(|tx| toggle_link(tx, None, ToggleLinkAttributes::default()));
    assert!(matches!(
        result,
        Err(Error::Invariant("empty link extraction"))
    ));
    assert_eq!(editor.state().to_json()?, previous);
    Ok(())
}
