use crate::*;
use serde_json::json;

#[test]
fn collaborative_unknown_nodes_preserve_types_payloads_children_and_text() -> Result<(), Error> {
    let document: SerializedEditorState = serde_json::from_value(json!({"root":{
        "type":"root","version":1,"children":[{
            "type":"future-panel","version":7,"layout":{"columns":[1,2]},"children":[
                {"type":"future-text","version":3,"text":"a😀b","format":1,"mode":"normal","style":"color:red","detail":0,"$":{"id":"future-child","unrecognized":{"x":true}}},
                {"type":"future-widget","version":9,"payload":[true,null,4]}
            ]
        }]
    }}))?;
    let editor = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .initial_state(document.clone())
        .build()
        .expect("collaborative import");
    let view = editor.state().view();
    let panel = view.first_child(NodeKey::ROOT).expect("panel");
    let text = view.first_child(panel).expect("text");
    let widget = view.last_child(panel).expect("widget");
    assert_eq!(view.type_name(panel)?, "future-panel");
    assert_eq!(view.type_name(text)?, "future-text");
    assert_eq!(view.type_name(widget)?, "future-widget");
    assert!(view.is_element(panel));
    assert!(view.is_text(text));
    assert_eq!(view.kind(widget), Some(NodeKind::Decorator));
    assert_eq!(view.text_content(text), "a😀b");
    assert_eq!(
        editor.state().to_json()?.root["children"],
        document.root["children"]
    );
    let mut strict = Editor::builder(EditorMode::Headless)
        .build()
        .expect("strict editor");
    assert!(
        matches!(strict.parse_editor_state(&document), Err(Error::UnknownSerializedType(name)) if name == "future-panel")
    );
    Ok(())
}

#[test]
fn remote_unknown_create_and_update_keep_the_original_serialized_name() -> Result<(), Error> {
    let editor = Editor::builder(EditorMode::ViewAttached)
        .opaque_unknown_types(true)
        .build()
        .expect("editor");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions {
                include_state: true,
            },
            track_text_content: false,
        },
    );
    let output = core.apply(Input::ApplyRemote {
        changes: vec![
            NodeChange::Create { local: LocalNode(0), json: serde_json::from_value(json!({"type":"next-text","version":4,"text":"ab","mode":"normal","format":0,"style":"","detail":0,"custom":42}))? },
            NodeChange::Create { local: LocalNode(1), json: serde_json::from_value(json!({"type":"next-block","version":2,"children":[],"meta":{"enabled":true}}))? },
            NodeChange::Children { parent: NodeTarget::Local(LocalNode(1)), children: vec![NodeTarget::Local(LocalNode(0))] },
            NodeChange::Children { parent: NodeTarget::Key(NodeKey::ROOT), children: vec![NodeTarget::Local(LocalNode(1))] },
        ], options: UpdateOptions::default(),
    }, HistoryTime(0)).expect("remote create");
    assert!(!output.diff.ops.is_empty());
    let view = core.state().view();
    let block = view.first_child(NodeKey::ROOT).expect("block");
    let text = view.first_child(block).expect("text");
    core.apply(
        Input::ApplyRemote {
            changes: vec![NodeChange::SpliceText {
                node: NodeTarget::Key(text),
                range: Utf16Offset(1)..Utf16Offset(1),
                insert: "😀".into(),
            }],
            options: UpdateOptions::default(),
        },
        HistoryTime(1),
    )
    .expect("remote splice");
    assert_eq!(
        core.state().to_json()?.root["children"][0],
        json!({
            "type":"next-block","version":2,"meta":{"enabled":true},"children":[
                {"type":"next-text","version":4,"text":"a😀b","mode":"normal","format":0,"style":"","detail":0,"custom":42}
            ]
        })
    );
    Ok(())
}

#[test]
fn opaque_own_export_is_flat_and_tracks_added_and_cleared_framework_fields() -> Result<(), Error> {
    static STATE: StateKey<String> = StateKey::new("value", |v| {
        v.and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .into()
    });
    let mut editor = Editor::builder(EditorMode::Headless).opaque_unknown_types(true)
        .initial_state(serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[
            {"type":"future-block","version":8,"textStyle":"color:red","children":[
                {"type":"future-text","version":2,"text":"hello","$":{"value":"old"},"custom":true}
            ]}
        ]}}))?).build().expect("editor");
    let block = editor
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("block");
    let text = editor.state().view().first_child(block).expect("text");
    assert_eq!(
        editor.state().view().export_json(block)?["children"],
        json!([])
    );
    assert_eq!(
        crate::opaque::raw(
            editor
                .state()
                .view()
                .slot(block)
                .expect("slot")
                .data
                .as_ref()
        )
        .expect("opaque")["children"],
        json!([])
    );
    assert_eq!(
        editor.state().view().export_json(block)?["textStyle"],
        json!("color:red")
    );
    editor.update(|tx| {
        tx.text(text)?.set_format(TextFormat::BOLD)?;
        tx.element(block)?.set_text_style("")?;
        tx.set_state(text, &STATE, String::new())?;
        Ok(())
    })?;
    let own = editor.state().view().export_json(text)?;
    assert_eq!(own["format"], json!(1));
    assert!(!own.contains_key("$"));
    assert_eq!(own["custom"], json!(true));
    assert!(
        !editor
            .state()
            .view()
            .export_json(block)?
            .contains_key("textStyle")
    );
    Ok(())
}

#[test]
fn untouched_explicit_empty_opaque_fields_roundtrip() -> Result<(), Error> {
    let original = json!({"type":"future-block","version":4,"textStyle":"","$":{},"children":[]});
    let editor = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .initial_state(serde_json::from_value(
            json!({"root":{"type":"root","version":1,"children":[original.clone()]}}),
        )?)
        .build()
        .expect("editor");
    assert_eq!(editor.state().to_json()?.root["children"][0], original);
    Ok(())
}

#[test]
fn opaque_future_framework_enums_roundtrip_without_relaxing_known_node_validation()
-> Result<(), Error> {
    let unknown = json!({"type":"future-panel","version":8,"format":"future-layout","direction":"future-direction","children":[
        {"type":"future-text","version":3,"text":"a😀b","mode":"future-mode","format":17,"style":""}
    ]});
    let editor = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .initial_state(serde_json::from_value(
            json!({"root":{"type":"root","version":1,"children":[unknown.clone()]}}),
        )?)
        .build()
        .expect("future enums are opaque JSON");
    assert_eq!(editor.state().to_json()?.root["children"][0], unknown);
    let mut strict = Editor::builder(EditorMode::Headless)
        .opaque_unknown_types(true)
        .build()
        .expect("editor");
    assert!(strict.parse_editor_state(&serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[{"type":"text","version":1,"text":"known","mode":"future-mode"}]}}))?).is_err());
    Ok(())
}
