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

/// Each nested section recurses through a nested Markdown import, more deeply in a debug
/// build. These check the functional boundary on a generous stack; the release wasm32
/// probe checks the same inputs on the real 1 MiB stack.
fn on_large_stack<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(256 << 20)
        .spawn(work)
        .expect("spawn")
        .join()
        .expect("join")
}

fn nested_details(levels: usize) -> String {
    format!(
        "{}innermost\n{}",
        "<details>\n".repeat(levels),
        "</details>\n".repeat(levels)
    )
}

#[test]
fn nesting_deeper_than_any_committable_tree_fails_before_descending() {
    let outcome = on_large_stack(|| import(&nested_details(2000)).map(|_| ()));
    assert!(
        matches!(
            outcome,
            Err(Error::Markdown(lexical_markdown::Error::Model(
                lexical_model::Error::NestingTooDeep {
                    limit: lexical_model::MAX_NODE_DEPTH
                }
            )))
        ),
        "{outcome:?}"
    );
}

#[test]
fn the_deepest_committable_nesting_imports() -> Result<()> {
    // Each section adds one level; its summary and the summary text add two more.
    let levels = lexical_model::MAX_NODE_DEPTH - 2;
    let json = on_large_stack(move || -> Result<serde_json::Value> {
        let (editor, _) = import(&nested_details(levels))?;
        Ok(serde_json::to_value(editor.state().to_json()?)?)
    })?;
    let mut node = &json["root"];
    let mut depth = 0;
    while let Some(child) = node["children"]
        .as_array()
        .and_then(|children| children.iter().find(|child| child["type"] == "details"))
    {
        node = child;
        depth += 1;
    }
    assert_eq!(depth, levels);
    Ok(())
}

fn is_nesting_too_deep<T>(outcome: &Result<T>) -> bool {
    matches!(
        outcome,
        Err(Error::Markdown(lexical_markdown::Error::Model(
            lexical_model::Error::NestingTooDeep {
                limit: lexical_model::MAX_NODE_DEPTH
            }
        )))
    )
}

#[test]
fn sections_alternating_with_html_blockquotes_share_the_nesting_bound() {
    let markdown = format!(
        "{}innermost\n{}",
        "<blockquote>\n<details>\n".repeat(2000),
        "</details>\n</blockquote>\n".repeat(2000)
    );
    let outcome = on_large_stack(move || import(&markdown).map(|_| ()));
    assert!(is_nesting_too_deep(&outcome), "{outcome:?}");
}

#[test]
fn nested_html_blockquotes_in_an_editor_fail_before_descending_past_the_bound() {
    // Every editor list has HTML_BLOCKQUOTE, which imports each quote's content again.
    let markdown = format!(
        "{}innermost\n{}",
        "<blockquote>\n".repeat(2000),
        "</blockquote>\n".repeat(2000)
    );
    let outcome = on_large_stack(move || {
        markdown::markdown_to_serialized_editor_state_with_ids(&markdown, &context()).map(|_| ())
    });
    assert!(is_nesting_too_deep(&outcome), "{outcome:?}");
}

#[test]
fn the_cached_details_set_is_filtered_per_editor_on_one_thread() -> Result<()> {
    // The per-thread set cache holds the unfiltered list; each use filters it by the
    // nodes that editor registered, as Source `$editorTransformers` does.
    let markdown = "<details>\n<summary>Hi</summary>\n\n<details>\n<summary>In</summary>\n\nBody\n\n</details>\n\n</details>";
    let has_details = |json: &serde_json::Value| json.to_string().contains(r#""type":"details""#);
    for _ in 0..2 {
        let (editor, _) = import(markdown)?;
        let json = serde_json::to_value(editor.state().to_json()?)?;
        assert!(has_details(&json), "{json}");
        let state = markdown::markdown_to_serialized_editor_state_with_ids(markdown, &context())?;
        let json = serde_json::to_value(&state)?;
        assert!(!has_details(&json), "{json}");
        assert!(
            json.to_string().contains("&lt;details&gt;") || json.to_string().contains("<details>"),
            "{json}"
        );
    }
    Ok(())
}
