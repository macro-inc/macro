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
            type_name
        }) if type_name == "paragraph"
    ));
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct CloneAware {
    cloned: bool,
}
impl NodeType for CloneAware {
    const TYPE: &'static str = "clone-aware";
    type Kind = TextKind;
    lexical_model::impl_default_node!();
    fn after_clone(&self) -> Option<Self> {
        Some(Self { cloned: true })
    }
}
impl TextNode for CloneAware {
    lexical_model::text_node_base!();
}
impl ExportDom for CloneAware {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>> {
        let other = ctx.state.next_sibling(key).unwrap();
        Ok(DomExportOutput::node(HtmlNode::Text(format!(
            "{}:{}:{}",
            self.cloned,
            ctx.text(key),
            ctx.text(other)
        ))))
    }
}
#[test]
fn selected_custom_text_exports_a_clone_and_reads_other_nodes_unsliced() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<CloneAware>()
        .build()
        .unwrap();
    let (key, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let custom = tx.create(CloneAware::default())?;
        tx.text(custom)?.set_text_content("abc")?;
        let other = tx.create_text("other")?;
        tx.append(paragraph, &[custom.key(), other.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(custom.key())
    })?;
    let selection = Selection::Range(RangeSelection::new(
        Point::text(key, Utf16Offset(1)),
        Point::text(key, Utf16Offset(2)),
    ));
    let exporter = HtmlExporter::new(
        register_core(ExportRegistry::builder())
            .node::<CloneAware>()
            .build(),
        EditorTheme::default(),
    );
    assert_eq!(
        exporter.generate_html_from_nodes(editor.state(), Some(&selection))?,
        "true:b:other"
    );
    assert!(!editor.state().view().get::<CloneAware>(key).unwrap().cloned);
    assert_eq!(editor.state().text_content(key), "abc");
    Ok(())
}
#[test]
fn fragment_after_runs_on_detached_fragment_and_propagates_errors() -> crate::Result<()> {
    fn callback<'a>(_: &ExportCtx<'a>, _: NodeKey) -> crate::Result<DomExportOutput<'a>> {
        let mut out =
            DomExportOutput::node(HtmlNode::Fragment(vec![HtmlNode::Text("kept".into())]));
        out.after = Some(Box::new(|_, detached, index| {
            assert_eq!(detached[index], HtmlNode::Fragment(Vec::new()));
            Err(crate::Error::InvalidExport("fragment callback"))
        }));
        Ok(out)
    }
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    let exporter = HtmlExporter::new(
        register_core(ExportRegistry::builder())
            .override_export("paragraph", callback)
            .build(),
        EditorTheme::default(),
    );
    assert!(matches!(
        exporter.generate_html_from_nodes(editor.state(), None),
        Err(crate::Error::InvalidExport("fragment callback"))
    ));
    Ok(())
}
