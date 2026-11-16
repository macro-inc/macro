//! Source registers DetailsNode only in read-only renderers (StaticRenderNodeTypes), and
//! its details transformer returns null in an editor without the node, so editors and
//! services keep GitHub `<details>` as text. A read-only registry imports the sections.
use macro_document_model::*;
use std::sync::Arc;

fn context() -> DocumentContext {
    DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    }
}

#[test]
fn github_details_markdown_imports_as_text_in_an_editor() -> Result<()> {
    let markdown = "<details><summary>Logs</summary>\n\nbody line\n\n</details>";
    let state = markdown::markdown_to_serialized_editor_state_with_ids(markdown, &context())?;
    let json = serde_json::to_string(&state)?;
    assert!(!json.contains(r#""type":"details""#), "{json}");
    assert!(!json.contains(r#""type":"details-summary""#), "{json}");
    let editor = markdown::editor_from_markdown(markdown, &context())?;
    let text = editor
        .state()
        .view()
        .text_content(lexical_model::NodeKey::ROOT);
    assert!(text.contains("<details>"), "{text}");
    assert!(text.contains("</details>"), "{text}");
    Ok(())
}

#[test]
fn an_editor_rejects_a_serialized_details_node_like_source() {
    // Lexical parseEditorState throws for a type the editor did not register.
    let mut editor = surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        lexical_model::EditorMode::Headless,
    )
    .build()
    .expect("registry");
    let state = r#"{"root":{"type":"root","version":1,"children":[{"type":"details","version":1,"open":false,"children":[{"type":"details-summary","version":1,"children":[]}]}]}}"#;
    assert!(editor.parse_editor_state_str(state).is_err());
}

#[test]
fn every_source_list_starts_with_its_details_transformer() -> Result<()> {
    for (list, name) in [
        ("internal", "DETAILS_INTERNAL"),
        ("external", "DETAILS_EXTERNAL"),
        ("all", "DETAILS_ALL"),
    ] {
        assert_eq!(
            transformers::list_names(list).map(|names| names[0]),
            Some(name)
        );
    }
    let options = transformers::MacroMarkdownOptions::default();
    let resolved = transformers::from_source_reference(
        "@macro-inc/lexical-core/transformers.ALL_TRANSFORMERS.0",
        &options,
    )?;
    assert!(matches!(
        resolved,
        lexical_markdown::Transformer::MultilineElement(_)
    ));
    Ok(())
}

#[test]
fn unclosed_and_nested_details_stay_text_in_every_list() -> Result<()> {
    let markdown = "<details open>\n<summary>A</summary>\n<details>\ninner\n</details>\n</details>\n\n<details>\nunclosed";
    let state = markdown::markdown_to_serialized_editor_state_with_ids(markdown, &context())?;
    let json = serde_json::to_string(&state)?;
    assert!(!json.contains(r#""type":"details"#), "{json}");
    Ok(())
}

fn static_render_editor() -> Result<lexical_model::Editor> {
    let mut builder = export_builder();
    for name in ["details", "details-summary"] {
        builder = register_static_render_node(builder, name)?;
    }
    Ok(builder.build()?)
}

/// Source `$editorTransformers(ALL_TRANSFORMERS)`: the ones whose nodes are registered.
fn registered_transformers(
    editor: &lexical_model::Editor,
) -> Result<lexical_markdown::Transformers> {
    let options = transformers::MacroMarkdownOptions::default();
    let mut out = Vec::new();
    for name in transformers::list_names("all").unwrap_or_default() {
        let transformer = transformers::transformer(name, &options)?;
        let dependencies = match &transformer {
            lexical_markdown::Transformer::Element(t) => t.dependencies(),
            lexical_markdown::Transformer::MultilineElement(t) => t.dependencies(),
            lexical_markdown::Transformer::TextMatch(t) => t.dependencies(),
            lexical_markdown::Transformer::TextFormat(_) => &[],
        };
        if dependencies
            .iter()
            .all(|name| editor.registry().get(name).is_some())
        {
            out.push(transformer);
        }
    }
    Ok(lexical_markdown::Transformers::new(out))
}

fn import(markdown: &str) -> Result<(lexical_model::Editor, lexical_markdown::Transformers)> {
    let mut editor = static_render_editor()?;
    let transformers = registered_transformers(&editor)?;
    editor.try_update(Default::default(), |tx| {
        markdown::convert_from_markdown_string(
            tx,
            markdown,
            &transformers,
            None,
            &lexical_markdown::MarkdownOptions::default(),
        )
    })?;
    Ok((editor, transformers))
}

#[test]
fn a_read_only_registry_honors_open_and_labels_a_section_without_a_summary() -> Result<()> {
    let (editor, _) = import("<details open>\n\nBody\n\n</details>")?;
    let json = serde_json::to_value(editor.state().to_json()?)?;
    let details = &json["root"]["children"][0];
    assert_eq!(details["type"], "details");
    assert_eq!(details["open"], true);
    let summary = &details["children"][0];
    assert_eq!(summary["type"], "details-summary");
    assert_eq!(summary["children"][0]["text"], "Details");
    assert_eq!(details["children"][1]["type"], "paragraph");
    assert_eq!(details["children"][1]["children"][0]["text"], "Body");
    Ok(())
}

#[test]
fn a_read_only_registry_round_trips_details_through_markdown() -> Result<()> {
    let source = "<details>\n<summary>**Summary**</summary>\n\nBody text\n\n</details>";
    let (editor, transformers) = import(source)?;
    let exported = markdown::convert_to_markdown_string(
        editor.state(),
        &transformers,
        None,
        &lexical_markdown::MarkdownOptions::default(),
    )?;
    assert_eq!(exported, source);
    Ok(())
}

#[test]
fn fenced_details_tags_and_nested_sections_import_whole() -> Result<()> {
    let (editor, _) = import(
        "<details>\n<summary>Outer</summary>\n\n```\n</details>\n```\n\n<details>\n<summary>Inner</summary>\n\nNested\n\n</details>\n\n</details>",
    )?;
    let json = serde_json::to_value(editor.state().to_json()?)?;
    let root = json["root"]["children"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(root.len(), 1, "{json}");
    let outer = &root[0];
    assert_eq!(outer["type"], "details");
    let kinds: Vec<_> = outer["children"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|child| child["type"].as_str().unwrap_or_default().to_owned())
        .collect();
    assert_eq!(kinds, ["details-summary", "code", "details"], "{json}");
    Ok(())
}
