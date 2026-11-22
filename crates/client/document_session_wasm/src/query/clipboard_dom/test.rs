use super::*;

#[test]
fn themed_selection_keeps_clipboard_content_and_headless_export_unchanged(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let text = tx.create_text("before & after")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let mut selection = NodeSelection::new();
        selection.add(paragraph.key());
        tx.set_selection(Some(Selection::Node(selection)))
    })?;
    let before = editor.state().to_json_string()?;
    let legacy = clipboard(
        editor.state(),
        "clipboard-test",
        true,
        ExportFlavor::Upstream,
    )?;
    let theme = lexical_html::EditorTheme {
        paragraph: Some("paragraph export".into()),
        ..Default::default()
    };
    let browser = clipboard_dom(
        editor.state(),
        "clipboard-test",
        true,
        ExportFlavor::Upstream,
        theme,
    )?;
    assert_eq!(browser.plain, legacy.plain);
    assert_eq!(browser.lexical, legacy.lexical);
    assert_eq!(browser.plain, "before & after");
    assert_eq!(browser.nodes.len(), 1);
    let paragraph = &browser.nodes[0];
    assert_eq!(paragraph.tag, "p");
    assert_eq!(paragraph.attributes[0].name, "class");
    assert_eq!(paragraph.attributes[0].value, "paragraph export");
    let text = &paragraph.children[0];
    assert_eq!(text.tag, "span");
    assert_eq!(
        text.attributes[0].styles,
        vec![wire::HtmlStyleMsg {
            name: "white-space".into(),
            value: "pre-wrap".into(),
        }]
    );
    assert_eq!(text.children[0].text, "before & after");
    assert_eq!(
        legacy.html,
        "<p><span style=\"white-space:pre-wrap\">before &amp; after</span></p>"
    );
    assert_eq!(editor.state().to_json_string()?, before);
    assert_eq!(
        clipboard(
            editor.state(),
            "clipboard-test",
            true,
            ExportFlavor::Upstream
        )?,
        legacy
    );
    Ok(())
}

#[test]
fn unselected_export_does_not_turn_into_a_whole_document_copy(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let text = tx.create_text("not selected")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_selection(None)
    })?;
    let data = clipboard_dom(
        editor.state(),
        "clipboard-test",
        false,
        ExportFlavor::Upstream,
        Default::default(),
    )?;
    assert_eq!(data.plain, "");
    assert_eq!(data.lexical, "");
    assert!(data.nodes.is_empty());
    assert!(clipboard_dom(
        editor.state(),
        "clipboard-test",
        true,
        ExportFlavor::Upstream,
        Default::default()
    )
    .is_err());
    Ok(())
}
