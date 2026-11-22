//! Download projection preserves source search-text ordering without mutating live state.
use macro_document_model::*;
use serde_json::json;

#[test]
fn saved_json_lifts_drafts_and_cleans_ui_after_capturing_block_search_text() -> Result<()> {
    let mut editor = preset_editor(EditorType::MarkdownSync);
    let state = editor.parse_editor_state(&serde_json::from_value(json!({"root":{"type":"root","children":[
        {"type":"paragraph","$":{"id":"block","searchText":"stale","extra":7},"children":[
            {"type":"text","text":"kept"},
            {"type":"comment-mark","ids":["draft"],"isDraft":true,"children":[{"type":"text","text":" draft"}]},
            {"type":"inline-search","text":" search"},
            {"type":"completion","children":[{"type":"text","text":" completion"}]}
        ]},
        {"type":"custom-code","language":"rust","$":{"id":"code","searchText":"stale"},"children":[{"type":"text","text":"fn main() {}"}]}
    ]}}))?)?;
    let before = state.to_json()?;
    let saved = save::saved_state(&state)?;
    let blocks = saved["root"]["children"].as_array().expect("blocks");
    assert_eq!(blocks[0]["$"]["searchText"], "kept draft search completion");
    assert_eq!(blocks[0]["$"]["extra"], 7);
    assert_eq!(blocks[0]["children"].as_array().expect("children").len(), 2);
    assert_eq!(blocks[0]["children"][0]["text"], "kept");
    assert_eq!(blocks[0]["children"][1]["type"], "text");
    assert_eq!(blocks[0]["children"][1]["text"], " draft");
    assert_eq!(blocks[1]["$"]["searchText"], "fn main() {}");
    assert_eq!(blocks[1]["children"], json!([]));
    assert_eq!(state.to_json()?, before);
    Ok(())
}

#[test]
fn duplicate_block_ids_use_the_final_element_search_text_for_each_matching_node() -> Result<()> {
    let mut editor = preset_editor(EditorType::MarkdownSync);
    let state = editor.parse_editor_state(&serde_json::from_value(
        json!({"root":{"type":"root","children":[
            {"type":"paragraph","$":{"id":"duplicate"},"children":[{"type":"text","text":"first"}]},
            {"type":"paragraph","$":{"id":"duplicate"},"children":[{"type":"text","text":"last"}]},
            {"type":"user-mention","userId":"fixture","displayName":"Fixture","$":{"id":"duplicate"}}
        ]}}),
    )?)?;
    let saved = save::saved_state(&state)?;
    assert_eq!(saved["root"]["children"][0]["$"]["searchText"], "last");
    assert_eq!(saved["root"]["children"][1]["$"]["searchText"], "last");
    assert_eq!(saved["root"]["children"][2]["$"]["searchText"], "last");
    Ok(())
}
