use super::*;
#[test]
fn core_export_formats_text_blocks_and_empty_paragraphs() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("a < b")?;
        let empty = tx.create(Paragraph {})?;
        tx.text(text)?
            .set_format(TextFormat::BOLD | TextFormat::ITALIC)?;
        tx.append(p, &[text.key()])?;
        tx.set_indent(p, 2)?;
        tx.element(p)?
            .set_direction(Some(TextDirection::Rtl))?
            .set_format(ElementFormat::Center)?;
        tx.append(NodeKey::ROOT, &[p.key(), empty.key()])
    })?;
    let exporter = HtmlExporter::new(
        register_core(ExportRegistry::builder()).build(),
        EditorTheme::default(),
    );
    assert_eq!(
        exporter.generate_html_from_nodes(editor.state(), None)?,
        "<p dir=\"rtl\" data-lexical-indent=\"2\" style=\"padding-inline-start:80px;text-align:center\"><i><b><strong style=\"white-space:pre-wrap\">a &lt; b</strong></b></i></p><p><br></p>"
    );
    Ok(())
}
#[test]
fn selection_slices_utf16_without_editing_the_snapshot() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("a😀b")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let selection = Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(2)),
        Point::text(text, Utf16Offset(3)),
    ));
    let exporter = HtmlExporter::new(
        register_core(ExportRegistry::builder()).build(),
        EditorTheme::default(),
    );
    assert_eq!(
        exporter.generate_html_from_nodes(editor.state(), Some(&selection))?,
        "<span style=\"white-space:pre-wrap\">�</span>"
    );
    assert_eq!(editor.state().text_content(text), "a😀b");
    Ok(())
}
fn fragment<'a>(_ctx: &ExportCtx<'a>, _key: NodeKey) -> crate::Result<DomExportOutput<'a>> {
    Ok(DomExportOutput::node(HtmlNode::Fragment(vec![
        HtmlNode::Text("before".into()),
    ])))
}
fn replace<'a>(_ctx: &ExportCtx<'a>, _key: NodeKey) -> crate::Result<DomExportOutput<'a>> {
    let mut output = DomExportOutput::element(HtmlElement::new("section"));
    output.after = Some(Box::new(|_, siblings, index| {
        let element = siblings
            .get_mut(index)
            .ok_or(crate::Error::InvalidExport("missing after node"))?;
        *element = HtmlNode::Text("after".into());
        Ok(())
    }));
    Ok(output)
}
#[test]
fn registry_overrides_fragments_and_after_callbacks_preserve_output_order() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("child")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    let exporter = HtmlExporter::new(
        register_core(ExportRegistry::builder())
            .override_export("paragraph", fragment)
            .build(),
        EditorTheme::default(),
    );
    assert_eq!(
        exporter.generate_html_from_nodes(editor.state(), None)?,
        "before<span style=\"white-space:pre-wrap\">child</span>"
    );
    let exporter = HtmlExporter::new(
        register_core(ExportRegistry::builder())
            .override_export("paragraph", replace)
            .build(),
        EditorTheme::default(),
    );
    assert_eq!(
        exporter.generate_html_from_nodes(editor.state(), None)?,
        "after"
    );
    let exporter = HtmlExporter::new(ExportRegistry::builder().build(), EditorTheme::default());
    assert!(matches!(
        exporter.generate_html_from_nodes(editor.state(), None),
        Err(crate::Error::UnregisteredNodeType {
            type_name: "paragraph"
        })
    ));
    Ok(())
}
