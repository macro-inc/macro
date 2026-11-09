use super::*;
use lexical_model::*;
use serde_json::json;

struct DroppedText;
impl SyncPolicy for DroppedText {
    fn comparison_kind(&self, ty: &str) -> ComparisonKind {
        match ty {
            "paragraph" => ComparisonKind::Paragraph,
            "text" => ComparisonKind::Text,
            _ => ComparisonKind::Exact,
        }
    }
    fn is_dropped(&self, view: StateRef<'_>, key: NodeKey) -> bool {
        view.text(key)
            .is_some_and(|text| text.text.as_str() == "hidden")
    }
    fn is_transparent(&self, _: StateRef<'_>, _: NodeKey) -> bool {
        false
    }
    fn is_dropped_json(&self, node: &SerializedNode) -> bool {
        node.get("type").and_then(Value::as_str) == Some("text")
            && node.get("text").and_then(Value::as_str) == Some("hidden")
    }
    fn is_transparent_json(&self, _: &SerializedNode) -> bool {
        false
    }
    fn local_state_keys(&self) -> &'static [&'static str] {
        &[]
    }
    fn ignore_in_remote_compare(&self, _: &str, _: &SerializedNode) -> &'static [&'static str] {
        &[]
    }
    fn keep_local_on_remote(&self, _: &str) -> &'static [&'static str] {
        &[]
    }
}
static DROP_TEXT: DroppedText = DroppedText;

#[test]
fn incremental_and_complete_comparison_filter_before_selecting_text() -> Result<()> {
    let editor = Editor::builder(EditorMode::ViewAttached)
        .initial_state(serde_json::from_value(json!({"root":{
            "type":"root","version":1,"children":[{
                "type":"paragraph","version":1,"textFormat":1,"textStyle":"color:red","children":[
                    {"type":"text","version":1,"text":"hidden","format":1,"style":"color:red","mode":"normal","detail":0},
                    {"type":"text","version":1,"text":"visible","format":2,"style":"color:blue","mode":"normal","detail":0}
                ]
            }]
        }})).expect("source fixture"))
        .build().expect("editor");
    let paragraph = editor
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let doc = new_doc(103)?;
    LoroProjection::initialize(&doc, editor.state(), &PlainPolicy, 0)?;
    let raw = doc.get_deep_value();
    let vv = doc.oplog_vv();
    let projection = LoroProjection::attach(&doc, editor.state(), &DROP_TEXT)?;
    projection
        .check(&doc, editor.state())
        .expect("full projected comparison");
    projection
        .check_nodes(&doc, editor.state(), &[paragraph])
        .expect("incremental projected comparison");
    assert_eq!(doc.get_deep_value(), raw);
    assert_eq!(doc.oplog_vv(), vv);
    Ok(())
}
