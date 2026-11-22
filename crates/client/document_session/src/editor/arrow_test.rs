use super::*;
use serde_json::json;
use std::sync::atomic::AtomicI64;

fn now(time: u64) -> Now {
    Now {
        mono: doc_sync_core::Millis(time),
        wall: doc_sync_core::UnixMillis(i64::try_from(time).expect("test time")),
    }
}

fn arrow(key: &str, shift: bool) -> Input {
    let event = KeyEvent {
        key: key.into(),
        shift,
        ..KeyEvent::default()
    };
    let command = if key == "ArrowLeft" {
        KeyCommand::ArrowLeft
    } else {
        KeyCommand::ArrowRight
    };
    Input::KeyDown {
        event: event.clone(),
        routed: Some(Command::Key {
            command,
            event: Some(event),
        }),
        routed_prevent_default: false,
        selection: ViewSelection::KeepModel,
    }
}

fn prevented(view: &[ViewEffect]) -> bool {
    view.iter()
        .any(|effect| matches!(effect, ViewEffect::Editor(Effect::PreventDefault)))
}

/// Upstream registerRichText arrows: an adjacent inline decorator becomes a
/// NodeSelection, and leaving it collapses beside the decorator.
#[test]
fn arrows_select_adjacent_inline_decorators_and_leave_them_beside_the_node() {
    let config = crate::application::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let mut surface = EditorSurface::new(config, 7, now(0)).expect("actual Macro session surface");
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    let mut view = Vec::new();
    surface
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("initialize");
    surface
        .apply(
            &doc,
            Input::SetState {
                state: serde_json::from_value(json!({"root":{"type":"root","children":[{
                    "type":"paragraph","children":[
                        {"type":"text","text":"Before "},
                        {"type":"tag-mention","optionId":"option","propertyDefinitionId":"definition","scope":"user","name":"Probe tag"},
                        {"type":"text","text":" after"}
                    ]
                }]}}))
                .expect("initial model"),
                tags: TagSet::default(),
            },
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("model");
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let children: Vec<NodeKey> = surface.state().view().children(paragraph).collect();
    let (before, tag, after) = (children[0], children[1], children[2]);
    assert_eq!(
        surface.state().view().type_name(tag).ok(),
        Some("tag-mention")
    );
    let caret =
        |surface: &mut EditorSurface, key: NodeKey, offset: u32, view: &mut Vec<ViewEffect>| {
            let point = Point::text(key, Utf16Offset(offset));
            surface
                .apply(
                    &doc,
                    Input::SelectionFromView {
                        selection: ViewSelection::Range {
                            anchor: point,
                            focus: point,
                            resolution_dirty: false,
                        },
                        change: None,
                    },
                    now(1),
                    Access::Edit,
                    view,
                )
                .expect("caret");
        };
    let node_selection = |surface: &EditorSurface| match surface.state().selection() {
        Some(Selection::Node(nodes)) => nodes.nodes(surface.state().view()).to_vec(),
        _ => Vec::new(),
    };
    let collapsed = |surface: &EditorSurface| match surface.state().selection() {
        Some(Selection::Range(range)) if range.is_collapsed() => Some(range.focus),
        _ => None,
    };

    // ArrowLeft from the start of " after" selects the tag.
    caret(&mut surface, after, 0, &mut view);
    view.clear();
    surface
        .apply(
            &doc,
            arrow("ArrowLeft", false),
            now(2),
            Access::Edit,
            &mut view,
        )
        .expect("ArrowLeft");
    assert_eq!(node_selection(&surface), vec![tag]);
    assert!(prevented(&view));

    // ArrowLeft again leaves the NodeSelection at the end of "Before ".
    view.clear();
    surface
        .apply(
            &doc,
            arrow("ArrowLeft", false),
            now(3),
            Access::Edit,
            &mut view,
        )
        .expect("ArrowLeft from node");
    assert_eq!(
        collapsed(&surface),
        Some(Point::text(before, Utf16Offset(7)))
    );
    assert!(prevented(&view));

    // ArrowRight from the end of "Before " selects the tag.
    view.clear();
    surface
        .apply(
            &doc,
            arrow("ArrowRight", false),
            now(4),
            Access::Edit,
            &mut view,
        )
        .expect("ArrowRight");
    assert_eq!(node_selection(&surface), vec![tag]);
    assert!(prevented(&view));

    // ArrowRight from the NodeSelection lands at the start of " after".
    view.clear();
    surface
        .apply(
            &doc,
            arrow("ArrowRight", false),
            now(5),
            Access::Edit,
            &mut view,
        )
        .expect("ArrowRight from node");
    assert_eq!(
        collapsed(&surface),
        Some(Point::text(after, Utf16Offset(0)))
    );
    assert!(prevented(&view));

    // Inside text the browser keeps ordinary caret movement.
    caret(&mut surface, after, 3, &mut view);
    view.clear();
    surface
        .apply(
            &doc,
            arrow("ArrowLeft", false),
            now(6),
            Access::Edit,
            &mut view,
        )
        .expect("ArrowLeft inside text");
    assert_eq!(
        collapsed(&surface),
        Some(Point::text(after, Utf16Offset(3)))
    );
    assert!(!prevented(&view));
}

#[test]
fn vertical_core_fallthrough_leaves_each_selected_block_at_the_source_model_point() {
    for kind in [
        "image",
        "video",
        "horizontalrule",
        "database-query",
        "document-card",
    ] {
        let config = crate::application::application_editor_config(
            EditorConfig::default(),
            Arc::new(AtomicI64::new(0)),
            macro_document_model::EditorType::MarkdownSync,
        );
        let mut surface = EditorSurface::new(config, 7, now(0)).expect("Macro surface");
        let doc = lexical_loro::new_doc(7).expect("document");
        let mut view = Vec::new();
        surface
            .init(&doc, now(0), Access::Edit, &mut view)
            .expect("initialize");
        surface.apply(&doc, Input::SetState {
            state: serde_json::from_value(json!({"root":{"type":"root","children":[
                {"type":"paragraph","children":[{"type":"text","text":"Before"}]},
                {"type":kind,"displayMode":"table","queryId":"query","prompt":"Count entries"},
                {"type":"paragraph","children":[{"type":"text","text":"end"}]}
            ]}})).expect("typed model"), tags: TagSet::default(),
        }, now(1), Access::Edit, &mut view).expect("set state");
        let children = surface
            .state()
            .view()
            .children_keys(NodeKey::ROOT)
            .expect("root children");
        assert_eq!(surface.state().view().type_name(children[1]).unwrap(), kind);
        for (key, next) in [("ArrowUp", children[0]), ("ArrowDown", children[2])] {
            surface
                .apply(
                    &doc,
                    Input::SelectionFromView {
                        selection: ViewSelection::Node(vec![children[1]]),
                        change: None,
                    },
                    now(2),
                    Access::Edit,
                    &mut view,
                )
                .expect("node selection");
            view.clear();
            let event = KeyEvent {
                key: key.into(),
                ..KeyEvent::default()
            };
            let command = if key == "ArrowUp" {
                KeyCommand::ArrowUp
            } else {
                KeyCommand::ArrowDown
            };
            surface
                .apply(
                    &doc,
                    Input::KeyDown {
                        event: event.clone(),
                        routed: Some(Command::Key {
                            command,
                            event: Some(event),
                        }),
                        routed_prevent_default: false,
                        selection: ViewSelection::KeepModel,
                    },
                    now(3),
                    Access::Edit,
                    &mut view,
                )
                .expect("vertical key");
            let Some(Selection::Range(range)) = surface.state().selection() else {
                panic!("range after {key} {kind}");
            };
            // Source selectPrevious uses the paragraph end, selectNext its
            // Element0 start. DOM feedback may subsequently descend to text.
            assert_eq!(
                range.anchor,
                Point::element(next, ChildIndex(if key == "ArrowUp" { 1 } else { 0 }))
            );
            assert_eq!(range.focus, range.anchor);
            assert!(prevented(&view));
        }
    }
}

#[test]
fn word_navigation_keeps_non_apple_browser_motion_and_apple_rich_text_fallback() {
    for os in [ViewOs::Other, ViewOs::Apple, ViewOs::Ios] {
        for start in [true, false] {
            for shift in [false, true] {
                let mut config = crate::application::application_editor_config(
                    EditorConfig::default(),
                    Arc::new(AtomicI64::new(0)),
                    macro_document_model::EditorType::MarkdownSync,
                );
                config.view_host = ViewHost {
                    engine: ViewEngine::Chromium,
                    os,
                };
                let mut surface = EditorSurface::new(config, 7, now(0)).expect("word session");
                let doc = lexical_loro::new_doc(7).expect("Loro");
                let mut view = Vec::new();
                surface
                    .init(&doc, now(0), Access::Edit, &mut view)
                    .expect("initialize");
                surface.apply(&doc, Input::SetState {
                    state: serde_json::from_value(json!({"root":{"type":"root","children":[{
                        "type":"paragraph","children":[
                            {"type":"user-mention","userId":"person","email":"person@example.com","displayName":"Person"},
                            {"type":"text","text":" after words"}
                        ]
                    }]}})).expect("word document"), tags: TagSet::default(),
                }, now(0), Access::Edit, &mut view).expect("install");
                let state = surface.state().view();
                let block = state.first_child(NodeKey::ROOT).expect("paragraph");
                let text = state.last_child(block).expect("text");
                let initial = if start {
                    Point::text(text, Utf16Offset(6))
                } else {
                    Point::element(block, ChildIndex(0))
                };
                surface
                    .apply(
                        &doc,
                        Input::SelectionFromView {
                            selection: ViewSelection::Range {
                                anchor: initial,
                                focus: initial,
                                resolution_dirty: false,
                            },
                            change: None,
                        },
                        now(1),
                        Access::Edit,
                        &mut view,
                    )
                    .expect("caret");
                let json_before = surface.state().to_json().expect("before JSON");
                let frontiers = doc.oplog_frontiers();
                view.clear();
                let apple = matches!(os, ViewOs::Apple | ViewOs::Ios);
                let event = KeyEvent {
                    key: if start {
                        "ArrowLeft".into()
                    } else {
                        "ArrowRight".into()
                    },
                    ctrl: !apple,
                    meta: apple,
                    shift,
                    ..Default::default()
                };
                surface
                    .apply(
                        &doc,
                        Input::KeyDown {
                            event: event.clone(),
                            routed: Some(Command::Key {
                                command: if start {
                                    KeyCommand::MoveToStart
                                } else {
                                    KeyCommand::MoveToEnd
                                },
                                event: Some(event),
                            }),
                            routed_prevent_default: false,
                            selection: ViewSelection::KeepModel,
                        },
                        now(2),
                        Access::Edit,
                        &mut view,
                    )
                    .expect("word key");
                let range = surface
                    .state()
                    .selection()
                    .and_then(Selection::as_range)
                    .expect("word range");
                let edge = if start {
                    Point::element(block, ChildIndex(0))
                } else {
                    Point::text(text, Utf16Offset(12))
                };
                assert_eq!(range.focus, if apple { edge } else { initial });
                assert_eq!(range.anchor, if apple && !shift { edge } else { initial });
                assert_eq!(prevented(&view), apple);
                assert_eq!(surface.state().to_json().expect("after JSON"), json_before);
                assert_eq!(doc.oplog_frontiers(), frontiers);
            }
        }
    }
}
