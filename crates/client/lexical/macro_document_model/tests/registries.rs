//! Source registry membership, replacements and stored JSON compatibility.
use lexical_model::*;
use lexical_rich_nodes::{
    code::CodeNode,
    list::{ListNode, ListType},
};
use macro_document_model::{nodes::*, *};
#[derive(serde::Deserialize)]
struct RegistryCase {
    name: String,
    types: Vec<String>,
    replacements: std::collections::BTreeMap<String, String>,
}
#[test]
fn registry_membership_and_replacements_match_the_source() {
    let cases: Vec<RegistryCase> =
        serde_json::from_str(include_str!("corpus/registries.json")).unwrap();
    for case in cases {
        let editor = match case.name.as_str() {
            "export" => export_registry(),
            "headless" => headless_editor(),
            "plain-text" => preset_editor(EditorType::PlainText),
            "title" => preset_editor(EditorType::Title),
            "markdown" => preset_editor(EditorType::Markdown),
            "markdown-sync" => preset_editor(EditorType::MarkdownSync),
            "chat" => preset_editor(EditorType::Chat),
            "calendar" => preset_editor(EditorType::Calendar),
            other => panic!("unknown registry {other}"),
        };
        let mut types = editor
            .registry()
            .type_table()
            .iter()
            .map(|row| row.type_name.to_owned())
            .collect::<Vec<_>>();
        types.sort();
        assert_eq!(types, case.types, "{}", case.name);
        let replacements = editor
            .registry()
            .type_table()
            .iter()
            .filter_map(|row| {
                let entry = editor.registry().get(row.type_name)?;
                let replacement = editor.registry().node(entry.replaced_by?)?;
                Some((row.type_name.to_owned(), replacement.type_name.to_owned()))
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(replacements, case.replacements, "{}", case.name);
        assert_eq!(
            editor.mode(),
            if matches!(case.name.as_str(), "export" | "headless") {
                EditorMode::Headless
            } else {
                EditorMode::ViewAttached
            }
        );
    }
}
#[test]
fn headless_keeps_imported_lists_exact_but_replaces_authored_creation() -> Result<()> {
    let input = r#"{"root":{"type":"root","children":[{"type":"list","listType":"bullet","start":1,"children":[]},{"type":"code","language":"js","children":[]}]}}"#;
    let mut export = export_registry();
    let state = export.parse_editor_state_str(input)?;
    let children = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(state.type_name(children[0])?, "list");
    assert_eq!(state.type_name(children[1])?, "code");
    let mut headless = headless_editor();
    let state = headless.parse_editor_state_str(input)?;
    let children = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(state.type_name(children[0])?, "list");
    assert_eq!(state.type_name(children[1])?, "custom-code");
    assert_eq!(
        state
            .view()
            .get::<CustomCodeNode>(children[1])
            .unwrap()
            .code
            .language(),
        Some("js")
    );
    let mut tx = headless.transaction();
    let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
    let code = tx.create(CodeNode::default())?;
    assert_eq!(tx.type_name(list)?, "task-list");
    assert_eq!(tx.type_name(code)?, "custom-code");
    assert!(matches!(
        headless.parse_editor_state_str(
            r#"{"root":{"type":"root","children":[{"type":"future-node"}]}}"#
        ),
        Err(lexical_model::Error::UnknownSerializedType(_))
    ));
    Ok(())
}
#[test]
fn projected_task_list_setters_replace_imported_null_values() -> Result<()> {
    let mut editor = export_registry();
    let mut tx = editor.transaction();
    let key = tx.import_node(
        serde_json::json!({"type":"task-list","listType":null,"start":null})
            .as_object()
            .unwrap(),
    )?;
    tx.get_mut::<ListNode>(key)?.set_start(3);
    tx.get_mut::<ListNode>(key)?.set_list_type(ListType::Number);
    let json = tx.view().export_json(key)?;
    assert_eq!(json.get("start"), Some(&3.into()));
    assert_eq!(json.get("listType"), Some(&"number".into()));
    assert_eq!(json.get("tag"), Some(&"ol".into()));
    Ok(())
}
#[test]
fn default_await_factory_uses_injected_random_and_true_inline() -> Result<()> {
    let mut editor = export_builder()
        .extension_state(NodeRandom(std::sync::Arc::new(|size| vec![0; size])))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let key = tx.create_resolved::<AwaitNode>()?;
    let node = tx.get::<AwaitNode>(key).unwrap();
    assert_eq!(node.await_id.as_deref(), Some("uuuuuuuuuuuuuuuuuuuuu"));
    assert!(node.inline);
    assert!(VideoNode::default().controls);
    assert_eq!(
        DocumentCardNode::default().preview_box,
        default_preview_box()
    );
    assert_eq!(DiffNode::default().label.as_deref(), Some("AI Suggestion"));
    Ok(())
}
