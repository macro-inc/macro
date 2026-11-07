use super::*;
#[test]
fn duplicate_format_tag_replaces_value_without_reordering_keys() -> Result<()> {
    let t = Transformers::new([
        Transformer::TextFormat(crate::builtin::BOLD_STAR.clone()),
        Transformer::TextFormat(crate::builtin::ITALIC_STAR.clone()),
        Transformer::TextFormat(TextFormatTransformer {
            format: Cow::Borrowed(&[TextFormatType::Italic]),
            tag: Cow::Borrowed("**"),
            intraword: true,
        }),
    ]);
    assert_eq!(t.format_by_tag, vec![("**".into(), 2), ("*".into(), 1)]);
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(&mut tx, "**text**", &t, None, &MarkdownOptions::default())?;
    let text = tx.first_descendant(NodeKey::ROOT).expect("text");
    assert_eq!(tx.text_data(text)?.format.bits(), 2);
    Ok(())
}
/// upstream: format arrays toggle in order, retaining mutually exclusive format rules.
#[test]
fn format_array_uses_core_toggle_semantics_in_order() -> Result<()> {
    let t = Transformers::new([Transformer::TextFormat(TextFormatTransformer {
        format: Cow::Borrowed(&[TextFormatType::Subscript, TextFormatType::Superscript]),
        tag: Cow::Borrowed("~"),
        intraword: true,
    })]);
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(&mut tx, "~text~", &t, None, &MarkdownOptions::default())?;
    let text = tx.first_descendant(NodeKey::ROOT).expect("text");
    assert_eq!(tx.text_data(text)?.format, TextFormat::SUPERSCRIPT);
    Ok(())
}
#[test]
fn reusable_trigger_indexes_preserve_transformer_order() {
    let t = Transformers::new(
        crate::builtin::element_transformers()
            .into_iter()
            .chain(crate::builtin::text_format_transformers())
            .chain(crate::builtin::text_match_transformers()),
    );
    assert_eq!(t.element_for_enter().count(), 4);
    assert_eq!(
        t.formats_for_trigger(42)
            .map(|t| t.tag.as_ref())
            .collect::<Vec<_>>(),
        vec!["***", "**", "*"]
    );
    assert_eq!(t.matches_for_trigger(41).count(), 1);
    assert_eq!(t.composition_end_triggers(), &[32, 96, 42, 95, 61, 126, 41]);
    assert_eq!(Transformers::default().composition_end_triggers(), &[32]);
}
