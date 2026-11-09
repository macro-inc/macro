use super::*;

#[test]
fn restored_headless_caret_retains_typing_attributes_and_rejects_view_input() {
    let mut surface = EditorSurface::new(
        EditorConfig {
            mode: EditorMode::Headless,
            builder: Arc::new(|mode, peer| {
                default_editor_builder(mode, peer).initial_state(
                    serde_json::from_value(
                        serde_json::json!({"root":{"type":"root","version":1,"children":[{
                            "type":"paragraph","version":1,"children":[{
                                "type":"text","version":1,"text":"abcdef","format":1,
                                "detail":0,"mode":"normal","style":"color: red;"
                            }]
                        }]}}),
                    )
                    .unwrap(),
                )
            }),
            ..EditorConfig::default()
        },
        17,
        Now {
            mono: doc_sync_core::Millis(0),
            wall: doc_sync_core::UnixMillis(0),
        },
    )
    .unwrap();
    let text = surface
        .core
        .state()
        .view()
        .descendants(NodeKey::ROOT)
        .find_map(|(key, _)| surface.core.state().view().is_text(key).then_some(key))
        .unwrap();
    let restore = |offset| Input::Command {
        command: Command::Extension(ExtensionCommand::new(
            &builder::RESTORE_MODEL_SELECTION,
            RangeSelection::new(
                Point::text(text, Utf16Offset(offset)),
                Point::text(text, Utf16Offset(offset)),
            ),
        )),
        selection: ViewSelection::KeepModel,
    };
    surface.core.apply(restore(2), HistoryTime(0)).unwrap();
    surface
        .core
        .apply(
            Input::Command {
                command: Command::FormatText(TextFormatType::Italic),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap();
    surface.core.apply(restore(4), HistoryTime(2)).unwrap();
    let before = surface.core.state().to_json().unwrap();
    let error = surface
        .core
        .apply(
            Input::SelectionFromView {
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(0)),
                    focus: Point::text(text, Utf16Offset(0)),
                    resolution_dirty: false,
                },
                change: None,
            },
            HistoryTime(3),
        )
        .unwrap_err();
    assert!(matches!(error.error, Error::ViewSelectionInHeadless));
    assert_eq!(surface.core.state().to_json().unwrap(), before);
    surface
        .core
        .apply(
            Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(4),
        )
        .unwrap();
    let state = surface.core.state().to_json().unwrap();
    let nodes = state.root["children"][0]["children"].as_array().unwrap();
    assert_eq!(
        nodes
            .iter()
            .filter_map(|node| node["text"].as_str())
            .collect::<String>(),
        "abcdxef"
    );
    let inserted = nodes
        .iter()
        .find(|node| node["text"] == "x")
        .expect("separate styled insertion");
    assert_eq!(inserted["format"], serde_json::json!(3));
    assert_eq!(inserted["style"], serde_json::json!("color: red;"));
}
