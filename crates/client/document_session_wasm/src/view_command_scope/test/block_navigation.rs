use super::*;
use macro_document_model::{nodes::*, surface, EditorType};

fn navigation_editor() -> Editor {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("Macro editor");
    editor
        .update(|tx| {
            let first = tx.create(HorizontalRuleNode::default())?;
            let second = tx.create(HorizontalRuleNode::default())?;
            tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::element(NodeKey::ROOT, ChildIndex(0)),
            ))))?;
            Ok(())
        })
        .expect("root caret");
    editor
}

fn down() -> Command {
    Command::Key {
        command: KeyCommand::ArrowDown,
        event: None,
    }
}

fn plan(scope: u64) -> u64 {
    let Value::Handle(id) = execute_current(scope, Operation::NavigationPrepare).expect("prepare")
    else {
        panic!("plan");
    };
    assert_ne!(id, 0);
    id
}

#[test]
fn block_role_is_fixed_unique_and_unavailable_to_ordinary_callbacks() {
    let registry = Registry::with_host(Arc::new(Transport(|call: &Call| {
        assert!(execute_current(call.scope.raw(), Operation::NavigationPrepare).is_err());
        Ok(false)
    })))
    .unwrap();
    let mut editor = navigation_editor();
    registry
        .insert(1, CommandPriority::Low, |registration, listener| {
            editor.register_command_listener(registration, listener)
        })
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert!(registry
        .insert_role(
            KeyCommand::Enter,
            2,
            CommandPriority::Low,
            Role::BlockNavigation,
            |registration, listener| editor.register_command_listener(registration, listener)
        )
        .is_err());
    let handle = registry
        .insert_role(
            KeyCommand::ArrowDown,
            2,
            CommandPriority::Low,
            Role::BlockNavigation,
            |registration, listener| {
                assert_eq!(registration.priority, CommandPriority::Low);
                assert_eq!(registration.placement, Placement::Before);
                editor.register_command_listener(registration, listener)
            },
        )
        .unwrap();
    assert_eq!(
        registry
            .insert_role(
                KeyCommand::ArrowDown,
                2,
                CommandPriority::Low,
                Role::BlockNavigation,
                |_, _| panic!("duplicate native registration")
            )
            .unwrap(),
        handle
    );
    assert!(registry
        .insert_role(
            KeyCommand::ArrowDown,
            3,
            CommandPriority::Low,
            Role::BlockNavigation,
            |_, _| panic!("second role installation")
        )
        .is_err());
}

#[test]
fn wrong_scope_cannot_consume_another_plan_and_complete_is_one_shot() {
    let registry = Registry::with_host(Arc::new(Transport(|call: &Call| {
        let scope = call.scope.raw();
        let id = plan(scope);
        assert!(execute_current(scope + 1, Operation::NavigationComplete(id, Ok(None))).is_err());
        assert!(matches!(
            execute_current(scope, Operation::NavigationBlock(id)).unwrap(),
            Value::Key(None)
        ));
        assert!(matches!(
            execute_current(scope, Operation::NavigationComplete(id, Ok(None))).unwrap(),
            Value::Handled(true)
        ));
        assert!(execute_current(scope, Operation::NavigationComplete(id, Ok(None))).is_err());
        assert!(execute_current(scope, Operation::NavigationCancel(id)).is_err());
        Ok(true)
    })))
    .unwrap();
    let mut editor = navigation_editor();
    registry
        .insert_role(
            KeyCommand::ArrowDown,
            1,
            CommandPriority::Low,
            Role::BlockNavigation,
            |registration, listener| editor.register_command_listener(registration, listener),
        )
        .unwrap();
    let (_, commit) = registry
        .invoke(doc_sync_core::Access::Read, || editor.dispatch(&down()))
        .unwrap()
        .unwrap();
    assert!(matches!(commit.next.selection(), Some(Selection::Node(_))));
}

#[test]
fn cancel_wrong_id_and_same_selection_mutation_burn_the_plan_without_selection() {
    for scenario in 0..3 {
        let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
            let scope = call.scope.raw();
            let id = plan(scope);
            match scenario {
                0 => {
                    execute_current(scope, Operation::NavigationCancel(id)).unwrap();
                    assert!(execute_current(scope, Operation::NavigationCancel(id)).is_err());
                }
                1 => assert!(execute_current(
                    scope,
                    Operation::NavigationComplete(id + 1, Ok(None))
                )
                .is_err()),
                _ => {
                    let Value::Bytes(selection) =
                        execute_current(scope, Operation::Selection).unwrap()
                    else {
                        panic!("selection");
                    };
                    execute_current(
                        scope,
                        Operation::SetSelection(
                            wire::SelectionMsg::deserialize(&selection).unwrap(),
                        ),
                    )
                    .unwrap();
                    assert!(
                        execute_current(scope, Operation::NavigationComplete(id, Ok(None)))
                            .is_err()
                    );
                }
            }
            assert!(execute_current(scope, Operation::NavigationComplete(id, Ok(None))).is_err());
            Ok(false)
        })))
        .unwrap();
        let mut editor = navigation_editor();
        let original = editor.state().selection().cloned();
        registry
            .insert_role(
                KeyCommand::ArrowDown,
                1,
                CommandPriority::Low,
                Role::BlockNavigation,
                |registration, listener| editor.register_command_listener(registration, listener),
            )
            .unwrap();
        registry
            .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&down()))
            .unwrap()
            .unwrap();
        assert_eq!(editor.state().selection(), original.as_ref());
    }
}

#[test]
fn retirement_and_self_unregistration_refuse_and_consume_without_selecting() {
    for retire in [false, true] {
        let handle = Arc::new(AtomicU64::new(0));
        let owned = handle.clone();
        let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
            let scope = call.scope.raw();
            let id = plan(scope);
            if retire {
                request_retire_current(call.owner.raw(), call.invocation.raw(), scope).unwrap();
            } else {
                execute_current(scope, Operation::Unregister(owned.load(Ordering::SeqCst)))
                    .unwrap();
            }
            assert!(execute_current(scope, Operation::NavigationComplete(id, Ok(None))).is_err());
            assert!(execute_current(scope, Operation::NavigationComplete(id, Ok(None))).is_err());
            Ok(false)
        })))
        .unwrap();
        let mut editor = navigation_editor();
        let original = editor.state().selection().cloned();
        let id = registry
            .insert_role(
                KeyCommand::ArrowDown,
                1,
                CommandPriority::Low,
                Role::BlockNavigation,
                |registration, listener| editor.register_command_listener(registration, listener),
            )
            .unwrap();
        handle.store(id, Ordering::SeqCst);
        registry
            .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&down()))
            .unwrap()
            .unwrap();
        assert_eq!(editor.state().selection(), original.as_ref());
    }
}

#[test]
fn generic_keydown_consumption_precedes_block_role_and_direct_arrows_skip_code() {
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        observed.fetch_add(1, Ordering::SeqCst);
        assert!(plan(call.scope.raw()) > 0);
        Ok(false)
    })))
    .unwrap();
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .unwrap();
    editor
        .update(|tx| {
            let code = create_custom_code_node(tx, Some("rust"))?;
            set_custom_code(tx, code, Some("rust"), "one")?;
            let rule = tx.create(HorizontalRuleNode::default())?;
            tx.append(NodeKey::ROOT, &[code.key(), rule.key()])?;
            tx.select_end(code)?;
            Ok(())
        })
        .unwrap();
    registry
        .insert_role(
            KeyCommand::ArrowDown,
            1,
            CommandPriority::Low,
            Role::BlockNavigation,
            |registration, listener| editor.register_command_listener(registration, listener),
        )
        .unwrap();
    let original = editor.state().selection().cloned();
    assert_eq!(
        registry
            .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&down()))
            .unwrap()
            .unwrap()
            .0,
        Handled::No
    );
    assert_eq!(editor.state().selection(), original.as_ref());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    calls.store(0, Ordering::SeqCst);
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let event = KeyEvent {
        key: "ArrowDown".into(),
        ..KeyEvent::default()
    };
    let output = registry
        .invoke(doc_sync_core::Access::Edit, || {
            core.apply(
                Input::KeyDown {
                    event: event.clone(),
                    routed: Some(Command::Key {
                        command: KeyCommand::ArrowDown,
                        event: Some(event),
                    }),
                    routed_prevent_default: false,
                    selection: ViewSelection::KeepModel,
                },
                HistoryTime(0),
            )
        })
        .unwrap()
        .unwrap();
    assert_eq!(output.handled, Handled::Yes);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn actual_core_five_type_negative_controls_stop_then_leave_the_node_with_the_fixed_role() {
    for kind in [
        "image",
        "video",
        "horizontalrule",
        "database-query",
        "document-card",
    ] {
        for installed in [false, true] {
            let mut editor =
                document_session::register_editor_commands(surface::preset_builder_with_mode(
                    EditorType::MarkdownSync,
                    EditorMode::ViewAttached,
                ))
                .build()
                .unwrap();
            let ((target, after), _) = editor
                .update(|tx| {
                    let before = tx.create(Paragraph::default())?;
                    let first = tx.create_text("Before")?;
                    tx.append(before, &[first.key()])?;
                    let target = match kind {
                        "image" => tx.create(ImageNode::default())?.key(),
                        "video" => tx.create(VideoNode::default())?.key(),
                        "horizontalrule" => tx.create(HorizontalRuleNode::default())?.key(),
                        "database-query" => tx
                            .create(DatabaseQueryNode {
                                data: DatabaseQueryData {
                                    display_mode: DatabaseQueryDisplayMode::Table,
                                    ..DatabaseQueryData::default()
                                },
                            })?
                            .key(),
                        "document-card" => tx.create(DocumentCardNode::default())?.key(),
                        _ => unreachable!(),
                    };
                    let after = tx.create(Paragraph::default())?;
                    let last = tx.create_text("end")?;
                    tx.append(after, &[last.key()])?;
                    tx.append(NodeKey::ROOT, &[before.key(), target, after.key()])?;
                    tx.select_end(first)?;
                    Ok((target, after.key()))
                })
                .unwrap();
            let registry = Registry::with_host(Arc::new(Transport(|call: &Call| {
                let scope = call.scope.raw();
                let Value::Handle(id) =
                    execute_current(scope, Operation::NavigationPrepare).unwrap()
                else {
                    panic!("plan");
                };
                if id == 0 {
                    return Ok(false);
                }
                let Value::Handled(handled) = execute_current(
                    scope,
                    Operation::NavigationComplete(
                        id,
                        Ok(Some(
                            macro_document_model::plugins_group_b::block_navigation::EdgeRects {
                                block_top: 0.0,
                                block_bottom: 20.0,
                                caret_top: 0.0,
                                caret_bottom: 20.0,
                                caret_height: 20.0,
                            },
                        )),
                    ),
                )
                .unwrap() else {
                    panic!("completion");
                };
                Ok(handled)
            })))
            .unwrap();
            if installed {
                registry
                    .insert_role(
                        KeyCommand::ArrowDown,
                        1,
                        CommandPriority::Low,
                        Role::BlockNavigation,
                        |registration, listener| {
                            editor.register_command_listener(registration, listener)
                        },
                    )
                    .unwrap();
            }
            let mut core = EditorCore::new(
                editor,
                CoreConfig {
                    history: None,
                    editable: true,
                    diff: DiffOptions::default(),
                    track_text_content: false,
                },
            );
            for time in 0..if installed { 2 } else { 1 } {
                let event = KeyEvent {
                    key: "ArrowDown".into(),
                    ..KeyEvent::default()
                };
                registry
                    .invoke(doc_sync_core::Access::Edit, || {
                        core.apply(
                            Input::KeyDown {
                                event: event.clone(),
                                routed: Some(Command::Key {
                                    command: KeyCommand::ArrowDown,
                                    event: Some(event),
                                }),
                                routed_prevent_default: false,
                                selection: ViewSelection::KeepModel,
                            },
                            HistoryTime(time),
                        )
                    })
                    .unwrap()
                    .unwrap();
                if installed && time == 0 {
                    let Some(Selection::Node(nodes)) = core.state().selection() else {
                        panic!("missing block stop {kind}");
                    };
                    assert_eq!(nodes.keys().collect::<Vec<_>>(), [target]);
                } else {
                    // Same core without the app role skips the decorator. With
                    // it, the second press falls through to Source selectNext.
                    let Some(Selection::Range(range)) = core.state().selection() else {
                        panic!("missing range {kind}");
                    };
                    assert_eq!(range.anchor, Point::element(after, ChildIndex(0)), "{kind}");
                    assert_eq!(range.focus, range.anchor);
                }
            }
        }
    }
}
