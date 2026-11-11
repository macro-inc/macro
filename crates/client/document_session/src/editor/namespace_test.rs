use super::*;

#[test]
fn rich_paste_and_copy_share_the_configured_namespace() {
    for incoming in ["configured-editor", "other-editor"] {
        let now = Now {
            mono: doc_sync_core::Millis(0),
            wall: doc_sync_core::UnixMillis(0),
        };
        let mut surface = EditorSurface::new(
            EditorConfig {
                namespace: "configured-editor".into(),
                ..EditorConfig::default()
            },
            7,
            now,
        )
        .unwrap();
        let doc = lexical_loro::new_doc(7).unwrap();
        surface
            .init(&doc, now, Access::Edit, &mut Vec::new())
            .unwrap();
        surface.apply(&doc,Input::SetState {
            state:serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}})).unwrap(),
            tags:TagSet::default(),
        },now,Access::Edit,&mut Vec::new()).unwrap();
        let paragraph = surface
            .state()
            .view()
            .children(NodeKey::ROOT)
            .next()
            .unwrap();
        let point = Point::element(paragraph, ChildIndex(0));
        let mut payload = ClipboardPayload::default();
        payload.data.insert("application/x-lexical-editor".into(),serde_json::json!({
            "namespace":incoming,"nodes":[{"type":"text","version":1,"text":"rich","format":1,"detail":0,"mode":"normal","style":""}]
        }).to_string());
        payload.data.insert("text/plain".into(), "fallback".into());
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::Paste(payload),
                    selection: ViewSelection::Range {
                        anchor: point,
                        focus: point,
                        resolution_dirty: false,
                    },
                },
                now,
                Access::Edit,
                &mut Vec::new(),
            )
            .unwrap();
        assert_eq!(surface.namespace(), "configured-editor");
        assert_eq!(
            surface.state().root_text_content().as_ref(),
            if incoming == "configured-editor" {
                "rich"
            } else {
                "fallback"
            }
        );
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::SelectAll(None),
                    selection: ViewSelection::KeepModel,
                },
                now,
                Access::Edit,
                &mut Vec::new(),
            )
            .unwrap();
        let exported = lexical_rich_nodes::clipboard::get_lexical_content(
            surface.state().view(),
            surface.namespace(),
            surface.state().selection(),
        )
        .unwrap()
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&exported).unwrap();
        assert_eq!(value["namespace"], "configured-editor");
        if incoming == "configured-editor" {
            assert_eq!(value["nodes"][0]["type"], "text");
            assert_eq!(value["nodes"][0]["format"], 1);
        }
    }
}

#[cfg(feature = "application")]
#[test]
fn markdown_application_uses_the_source_document_namespace() {
    let config = crate::application_editor_config(
        EditorConfig::default(),
        Arc::new(std::sync::atomic::AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    assert_eq!(config.namespace, "block-md-main");
    assert_eq!(EditorConfig::default().namespace, "document-session");
}
