//! Source null text fields (slice B). Source TextNode stores a non-string
//! format/detail/style raw (Lexical 0.45.0 dist sha256 449d061d, setFormat
//! :6831, setDetail :6848, setStyle :6862), so a null from a Source-written Loro
//! document stays null: getters return it and exportJSON emits it. Mode null is
//! TEXT_MODE_TO_TYPE[null], undefined, and exports no key (slice A). Rows are
//! observed Source values from the probes on the same JSON.
use super::*;

fn load(editor: &mut Editor, json: &str) -> Result<(), Error> {
    let raw: SerializedEditorState = serde_json::from_str(json)?;
    let state = editor.parse_editor_state(&raw)?;
    editor.set_editor_state(state, TagSet::default())?;
    Ok(())
}
fn paragraph_json(editor: &Editor) -> Result<serde_json::Value, Error> {
    Ok(editor.state().to_json()?.root["children"][0].clone())
}
fn renormalize(editor: &mut Editor) -> Result<(), Error> {
    editor.update(|tx| {
        let paragraph = tx.view().first_child_or_err(NodeKey::ROOT)?;
        for key in tx.view().children(paragraph).collect::<Vec<_>>() {
            tx.mark_dirty(key)?;
        }
        Ok(())
    })?;
    Ok(())
}

#[test]
fn null_text_fields_stay_null_through_both_import_paths() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi ","format":null,"detail":null,"style":null,"mode":null}]}]}}"#,
    )?;
    assert_eq!(
        paragraph_json(&editor)?["children"][0],
        serde_json::json!({"detail":null,"format":null,"style":null,"text":"hi ","type":"text","version":1})
    );
    editor.update(|tx| {
        let text = tx.create_text("old")?;
        let imported = serde_json::json!({"type":"text","version":1,"text":"hi ","format":null,"detail":null,"style":null,"mode":null});
        tx.update_from_json(text, imported.as_object().expect("object"))?;
        assert_eq!(
            serde_json::Value::Object(tx.export_json(text)?),
            serde_json::json!({"detail":null,"format":null,"style":null,"text":"hi ","type":"text","version":1})
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn missing_text_fields_stay_absent_beside_null_ones() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi ","format":null}]}]}}"#,
    )?;
    assert_eq!(
        paragraph_json(&editor)?["children"][0],
        serde_json::json!({"format":null,"text":"hi ","type":"text","version":1})
    );
    Ok(())
}

#[test]
fn toggling_bold_on_a_null_format_gives_one_and_keeps_the_other_nulls() -> Result<(), Error> {
    // Source toggleFormat computes null ^ 1 = 1 (probe ee140e14, afterToggleBold).
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi ","format":null,"detail":null,"style":null,"mode":"normal"}]}]}}"#,
    )?;
    editor.update(|tx| {
        let paragraph = tx.view().first_child_or_err(NodeKey::ROOT)?;
        let text = tx.view().first_child_or_err(paragraph)?;
        tx.text(text)?.toggle_format(TextFormatType::Bold)?;
        Ok(())
    })?;
    assert_eq!(
        paragraph_json(&editor)?["children"][0],
        serde_json::json!({"detail":null,"format":1,"mode":"normal","style":null,"text":"hi ","type":"text","version":1})
    );
    Ok(())
}

#[test]
fn setting_a_style_on_a_null_style_replaces_the_null() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi ","format":null,"detail":null,"style":null,"mode":"normal"}]}]}}"#,
    )?;
    editor.update(|tx| {
        let paragraph = tx.view().first_child_or_err(NodeKey::ROOT)?;
        let text = tx.view().first_child_or_err(paragraph)?;
        tx.text(text)?.set_style("color: red")?;
        Ok(())
    })?;
    assert_eq!(
        paragraph_json(&editor)?["children"][0],
        serde_json::json!({"detail":null,"format":null,"mode":"normal","style":"color: red","text":"hi ","type":"text","version":1})
    );
    Ok(())
}

#[test]
fn a_null_left_text_merges_with_a_default_right_text_and_keeps_its_nulls() -> Result<(), Error> {
    // Source $canSimpleTextNodesBeMerged (:1900-1910): node1's null format or
    // style matches anything; the merged node keeps node1's fields (probe
    // ee140e14, afterSetModeAndInsertPlain: 'hi ' null + 'x' merged to 'hi x').
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi ","format":null,"detail":null,"style":null,"mode":"normal"},{"type":"text","text":"x","format":0,"detail":0,"style":"","mode":"normal"}]}]}}"#,
    )?;
    renormalize(&mut editor)?;
    assert_eq!(
        paragraph_json(&editor)?["children"],
        serde_json::json!([{"detail":null,"format":null,"mode":"normal","style":null,"text":"hi x","type":"text","version":1}])
    );
    Ok(())
}

#[test]
fn a_default_left_text_does_not_merge_with_a_null_right_text() -> Result<(), Error> {
    // The wildcard is node1's only: 0 === null is false.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"x","format":0,"detail":0,"style":"","mode":"normal"},{"type":"text","text":"hi ","format":null,"detail":null,"style":null,"mode":"normal"}]}]}}"#,
    )?;
    renormalize(&mut editor)?;
    assert_eq!(
        paragraph_json(&editor)?["children"],
        serde_json::json!([
            {"detail":0,"format":0,"mode":"normal","style":"","text":"x","type":"text","version":1},
            {"detail":null,"format":null,"mode":"normal","style":null,"text":"hi ","type":"text","version":1}
        ])
    );
    Ok(())
}

#[test]
fn mode_normal_texts_with_absent_format_and_style_on_both_sides_merge() -> Result<(), Error> {
    // undefined === undefined; only simple (mode normal) texts reach the rule.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a","mode":"normal"},{"type":"text","text":"b","mode":"normal"}]}]}}"#,
    )?;
    renormalize(&mut editor)?;
    assert_eq!(
        paragraph_json(&editor)?["children"],
        serde_json::json!([{"mode":"normal","text":"ab","type":"text","version":1}])
    );
    Ok(())
}

#[test]
fn a_mode_normal_text_with_absent_format_does_not_merge_with_a_default_format() -> Result<(), Error>
{
    // undefined === 0 is false.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a","mode":"normal","style":""},{"type":"text","text":"b","mode":"normal","format":0,"style":""}]}]}}"#,
    )?;
    renormalize(&mut editor)?;
    assert_eq!(
        paragraph_json(&editor)?["children"],
        serde_json::json!([
            {"mode":"normal","style":"","text":"a","type":"text","version":1},
            {"format":0,"mode":"normal","style":"","text":"b","type":"text","version":1}
        ])
    );
    Ok(())
}

#[test]
fn a_null_detail_does_not_block_a_merge() -> Result<(), Error> {
    // Detail is not part of the Source merge rule; node1's detail is kept.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a","format":0,"detail":null,"style":"","mode":"normal"},{"type":"text","text":"b","format":0,"detail":0,"style":"","mode":"normal"}]}]}}"#,
    )?;
    renormalize(&mut editor)?;
    assert_eq!(
        paragraph_json(&editor)?["children"],
        serde_json::json!([{"detail":null,"format":0,"mode":"normal","style":"","text":"ab","type":"text","version":1}])
    );
    Ok(())
}

#[test]
fn a_paragraph_exports_its_first_text_child_null_format_and_style() -> Result<(), Error> {
    // ElementNode.exportJSON (:11419-11435) leaves textFormat/textStyle undefined
    // beside a text child; ParagraphNode.exportJSON backfills them from the first
    // text child's getFormat/getStyle, null here (probe be8649fb). The paragraph's
    // own fields stay 0/"" (updateFromJSON :11445 uses `|| 0`, `|| ''`), and the
    // reconciler skips a null child (:2429-2437).
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","textFormat":null,"textStyle":null,"children":[{"type":"text","text":"hi ","format":null,"detail":null,"style":null,"mode":null}]}]}}"#,
    )?;
    renormalize(&mut editor)?;
    let paragraph = paragraph_json(&editor)?;
    assert_eq!(paragraph["textFormat"], serde_json::Value::Null);
    assert_eq!(paragraph["textStyle"], serde_json::Value::Null);
    let key = editor.state().view().first_child_or_err(NodeKey::ROOT)?;
    let data = editor.state().view().element_data(key)?;
    assert_eq!(data.text_format, TextFormat::default());
    assert_eq!(&*data.text_style, "");
    Ok(())
}

#[test]
fn a_paragraph_omits_text_format_and_style_beside_an_absent_first_text_child() -> Result<(), Error>
{
    // The first text child's getFormat/getStyle are undefined, so JSON drops them.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi "}]}]}}"#,
    )?;
    let paragraph = paragraph_json(&editor)?;
    assert!(
        !paragraph
            .as_object()
            .expect("paragraph")
            .contains_key("textFormat")
    );
    assert!(
        !paragraph
            .as_object()
            .expect("paragraph")
            .contains_key("textStyle")
    );
    Ok(())
}

#[test]
fn the_storage_null_table_holds_exactly_the_keys_source_stores_as_null() -> Result<(), Error> {
    // Source's writer stores null for an undefined text detail/format/mode/style
    // (probe be8649fb) and a paragraph's direction/indent/textFormat/textStyle
    // (probe 1d9a47d4); the root carries neither. Nothing else is encoded.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    load(
        &mut editor,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a"},{"type":"linebreak"},{"type":"tab","version":1,"text":"\t","detail":2,"format":0,"mode":"normal","style":""}]}]}}"#,
    )?;
    let view = editor.state().view();
    let paragraph = view.first_child_or_err(NodeKey::ROOT)?;
    let children: Vec<_> = view.children(paragraph).collect();
    assert_eq!(view.storage_null_keys(NodeKey::ROOT), &[] as &[&str]);
    assert_eq!(
        view.storage_null_keys(paragraph),
        &["direction", "indent", "textFormat", "textStyle"]
    );
    assert_eq!(
        view.storage_null_keys(children[0]),
        &["detail", "format", "mode", "style"]
    );
    assert_eq!(view.storage_null_keys(children[1]), &[] as &[&str]);
    assert_eq!(
        view.storage_null_keys(children[2]),
        &["detail", "format", "mode", "style"]
    );
    Ok(())
}
