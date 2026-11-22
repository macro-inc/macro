use super::*;
use lexical_model::{Editor, EditorMode, SerializedEditorState};

#[test]
fn checklist_value_property_precedes_theme_without_changing_headless_attributes()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<ListNode>()
        .node::<ListItemNode>()
        .build()?;
    let input: SerializedEditorState = serde_json::from_value(
        serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"list","version":1,"listType":"check","tag":"ul","start":1,"children":[{"type":"listitem","version":1,"value":7,"checked":true,"children":[{"type":"text","version":1,"text":"item"}]}]}]}}),
    )?;
    let state = editor.parse_editor_state(&input)?;
    let registry = super::super::register_rich_nodes_html(lexical_html::register_core(
        ExportRegistry::builder(),
    ))
    .build();
    let theme = EditorTheme {
        list: Some(ListTheme {
            listitem: Some("item".into()),
            ..Default::default()
        }),
        ..Default::default()
    };
    let exporter = HtmlExporter::new(registry, theme);
    let nodes = exporter.generate_dom_from_nodes(&state, None)?;
    let Some(HtmlNode::Element(list)) = nodes.first() else {
        return Err("missing exported list".into());
    };
    let Some(HtmlNode::Element(item)) = list.children.first() else {
        return Err("missing exported item".into());
    };
    assert_eq!(
        item.dom_construction()
            .map(|(name, value, _, property)| (name, value, property))
            .collect::<Vec<_>>(),
        vec![
            ("role", "checkbox".into(), false),
            ("tabIndex", "-1".into(), false),
            ("aria-checked", "true".into(), false),
            ("value", "7".into(), true),
            ("class", "item".into(), false),
        ]
    );
    assert_eq!(item.get_attribute("value"), None);
    assert!(
        !exporter
            .generate_html_from_nodes(&state, None)?
            .contains("value=")
    );
    Ok(())
}
