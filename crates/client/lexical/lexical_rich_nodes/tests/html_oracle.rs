//! Export-only upstream HTML corpus, recorded with the pinned linkedom runtime.
#![cfg(feature = "html")]
use lexical_html::*;
use lexical_model::*;
use lexical_rich_nodes::{code::*, heading::*, link::*, list::*, mark::*, quote::*, table::*};
#[derive(serde::Deserialize)]
struct Case {
    name: String,
    input: SerializedEditorState,
    theme: EditorTheme,
    html: String,
    selection: Option<serde_json::Value>,
}
#[test]
fn pinned_upstream_exports_are_byte_identical()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HeadingNode>()
        .node::<QuoteNode>()
        .node::<CodeNode>()
        .node::<CodeHighlightNode>()
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .node::<ListNode>()
        .node::<ListItemNode>()
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .node::<MarkNode>()
        .build()?;
    let registry = lexical_rich_nodes::html::register_rich_nodes_html(register_core(
        ExportRegistry::builder(),
    ))
    .build();
    for line in include_str!("corpus/html.jsonl").lines() {
        let case: Case = serde_json::from_str(line)?;
        let state = editor.parse_editor_state(&case.input)?;
        let exporter = HtmlExporter::new(registry.clone(), case.theme);
        let selection = case.selection.map(|selection| {
            let point = |name: &str| {
                let p = &selection[name];
                let mut key = NodeKey::ROOT;
                for index in p["path"].as_array().unwrap() {
                    key = state.children_keys(key).unwrap()[index.as_u64().unwrap() as usize];
                }
                let offset = p["offset"].as_u64().unwrap() as u32;
                if p["kind"] == "element" {
                    Point::element(key, ChildIndex(offset))
                } else {
                    Point::text(key, Utf16Offset(offset))
                }
            };
            Selection::Range(RangeSelection::new(point("anchor"), point("focus")))
        });
        assert_eq!(
            exporter.generate_html_from_nodes(&state, selection.as_ref())?,
            case.html,
            "{}",
            case.name
        );
    }
    Ok(())
}
