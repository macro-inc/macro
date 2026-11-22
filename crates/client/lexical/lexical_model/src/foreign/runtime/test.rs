use super::*;
use std::sync::Mutex;
static ORDER: EventKey<u8> = EventKey::new("order");

#[test]
fn command_priorities_mix_native_and_runtime_listeners_and_refresh_the_table() -> Result<(), Error>
{
    struct Native;
    impl Plugin for Native {
        fn name(&self) -> &'static str {
            "native"
        }
        fn commands(&self) -> &[CommandRegistration] {
            &[CommandRegistration {
                command: CommandKind::InsertText,
                priority: CommandPriority::Normal,
                placement: Placement::After,
            }]
        }
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            tx.emit(&ORDER, 1);
            Ok(Handled::No)
        }
    }
    struct Host;
    impl ForeignListener for Host {
        fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
            assert_eq!(command, &Command::InsertText("x".into()));
            tx.emit(&ORDER, 2);
            Ok(Handled::No)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(Native)
        .build()
        .expect("editor");
    let id = editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::InsertText,
            priority: CommandPriority::High,
            placement: Placement::After,
        },
        Arc::new(Host),
    );
    assert_eq!(
        editor
            .listener_table()
            .levels(CommandKind::InsertText)
            .expect("levels")
            .bits(),
        12
    );
    let (handled, commit) = editor.dispatch(&Command::InsertText("x".into()))?;
    assert_eq!(handled, Handled::No);
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![2, 1]
    );
    editor.unregister_foreign_listener(id);
    editor.unregister_foreign_listener(id);
    assert_eq!(
        editor
            .listener_table()
            .levels(CommandKind::InsertText)
            .expect("levels")
            .bits(),
        4
    );
    Ok(())
}

#[test]
fn runtime_before_after_order_and_handled_stop_are_literal() -> Result<(), Error> {
    struct Host(Arc<Mutex<Vec<u8>>>, u8, Handled);
    impl ForeignListener for Host {
        fn handle(&self, _tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            self.0.lock().expect("log").push(self.1);
            Ok(self.2)
        }
    }
    let log = Arc::new(Mutex::new(vec![]));
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        },
        Arc::new(Host(log.clone(), 1, Handled::No)),
    );
    editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        },
        Arc::new(Host(log.clone(), 2, Handled::Yes)),
    );
    let before = editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::Before,
        },
        Arc::new(Host(log.clone(), 3, Handled::No)),
    );
    assert_eq!(editor.dispatch(&Command::Undo)?.0, Handled::Yes);
    assert_eq!(*log.lock().expect("log"), vec![3, 1, 2]);
    editor.unregister_foreign_listener(before);
    assert!(editor.listener_table().levels(CommandKind::Undo).is_some());
    Ok(())
}

#[test]
fn runtime_command_iteration_snapshots_each_priority() -> Result<(), Error> {
    struct Added(Arc<Mutex<Vec<u8>>>);
    impl ForeignListener for Added {
        fn handle(&self, _tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            self.0.lock().expect("log").push(3);
            Ok(Handled::No)
        }
    }
    struct Removed(Arc<Mutex<Vec<u8>>>);
    impl ForeignListener for Removed {
        fn handle(&self, _tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            self.0.lock().expect("log").push(2);
            Ok(Handled::No)
        }
    }
    struct First {
        log: Arc<Mutex<Vec<u8>>>,
        remove: Arc<Mutex<Option<ForeignListenerId>>>,
    }
    impl ForeignListener for First {
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            self.log.lock().expect("log").push(1);
            if let Some(id) = self.remove.lock().expect("id").take() {
                tx.unregister_foreign_listener(id);
            }
            tx.register_foreign_listener(
                CommandRegistration {
                    command: CommandKind::Undo,
                    priority: CommandPriority::Normal,
                    placement: Placement::After,
                },
                Arc::new(Added(self.log.clone())),
            );
            Ok(Handled::No)
        }
    }
    let log = Arc::new(Mutex::new(vec![]));
    let remove = Arc::new(Mutex::new(None));
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        },
        Arc::new(First {
            log: log.clone(),
            remove: remove.clone(),
        }),
    );
    *remove.lock().expect("id") = Some(editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        },
        Arc::new(Removed(log.clone())),
    ));
    assert_eq!(editor.dispatch(&Command::Undo)?.0, Handled::No);
    assert_eq!(*log.lock().expect("log"), vec![1, 2]);
    log.lock().expect("log").clear();
    assert_eq!(editor.dispatch(&Command::Undo)?.0, Handled::No);
    assert_eq!(*log.lock().expect("log"), vec![1, 3]);
    Ok(())
}

#[test]
fn runtime_listener_failures_roll_back_staged_model_writes() -> Result<(), Error> {
    struct Host;
    impl ForeignListener for Host {
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            let paragraph = tx.create(Paragraph {})?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Err(Error::Invariant("host failure"))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let id = editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        },
        Arc::new(Host),
    );
    assert!(editor.dispatch(&Command::Undo).is_err());
    assert_eq!(editor.state().node_count(), 1);
    editor.unregister_foreign_listener(id);
    assert!(editor.listener_table().levels(CommandKind::Undo).is_none());
    Ok(())
}

#[test]
fn runtime_transforms_follow_static_transforms_and_unregister_independently() -> Result<(), Error> {
    fn native(tx: &mut Transaction<'_>, _key: Id<Paragraph>) -> Result<(), Error> {
        tx.emit(&ORDER, 1);
        Ok(())
    }
    struct Host;
    impl ForeignTransform for Host {
        fn transform(&self, tx: &mut Transaction<'_>, _key: NodeKey) -> Result<(), Error> {
            tx.emit(&ORDER, 2);
            Ok(())
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Paragraph>(native)
        .build()
        .expect("editor");
    let id = editor.register_foreign_transform("paragraph", Arc::new(Host))?;
    let (_, commit) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])
    })?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 2]
    );
    editor.unregister_foreign_listener(id);
    editor.unregister_foreign_transform(id);
    editor.unregister_foreign_transform(id);
    let (_, commit) = editor.update(|tx| tx.mark_foreign_type_dirty("paragraph"))?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1]
    );
    assert!(matches!(
        editor.register_foreign_transform("missing", Arc::new(Host)),
        Err(Error::UnregisteredNodeType(_))
    ));
    assert!(
        editor
            .update(|tx| tx.mark_foreign_type_dirty("missing"))
            .is_err()
    );
    Ok(())
}

#[test]
fn runtime_transforms_snapshot_removal_until_the_next_transform_pass() -> Result<(), Error> {
    struct First {
        log: Arc<Mutex<Vec<u8>>>,
        remove: Arc<Mutex<Option<ForeignListenerId>>>,
    }
    impl ForeignTransform for First {
        fn transform(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
            self.log.lock().expect("log").push(1);
            if let Some(id) = self.remove.lock().expect("id").take() {
                tx.unregister_foreign_transform(id);
            }
            if tx.is_empty(key) {
                let text = tx.create_text("x")?;
                tx.append(key, &[text.key()])?;
            }
            Ok(())
        }
    }
    struct Second(Arc<Mutex<Vec<u8>>>);
    impl ForeignTransform for Second {
        fn transform(&self, _tx: &mut Transaction<'_>, _key: NodeKey) -> Result<(), Error> {
            self.0.lock().expect("log").push(2);
            Ok(())
        }
    }
    let log = Arc::new(Mutex::new(vec![]));
    let remove = Arc::new(Mutex::new(None));
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_transform(
        "paragraph",
        Arc::new(First {
            log: log.clone(),
            remove: remove.clone(),
        }),
    )?;
    *remove.lock().expect("id") =
        Some(editor.register_foreign_transform("paragraph", Arc::new(Second(log.clone())))?);
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])
    })?;
    assert_eq!(*log.lock().expect("log"), vec![1, 2, 1, 2]);
    log.lock().expect("log").clear();
    editor.update(|tx| tx.mark_foreign_type_dirty("paragraph"))?;
    assert_eq!(*log.lock().expect("log"), vec![1]);
    Ok(())
}

#[test]
fn runtime_transforms_added_during_a_pass_wait_for_the_next_pass() -> Result<(), Error> {
    struct Second(Arc<Mutex<Vec<u8>>>);
    impl ForeignTransform for Second {
        fn transform(&self, _tx: &mut Transaction<'_>, _key: NodeKey) -> Result<(), Error> {
            self.0.lock().expect("log").push(2);
            Ok(())
        }
    }
    struct First {
        log: Arc<Mutex<Vec<u8>>>,
        added: std::sync::atomic::AtomicBool,
    }
    impl ForeignTransform for First {
        fn transform(&self, tx: &mut Transaction<'_>, _key: NodeKey) -> Result<(), Error> {
            self.log.lock().expect("log").push(1);
            if !self.added.swap(true, std::sync::atomic::Ordering::SeqCst) {
                tx.register_foreign_transform("paragraph", Arc::new(Second(self.log.clone())))?;
            }
            Ok(())
        }
    }
    let log = Arc::new(Mutex::new(vec![]));
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_transform(
        "paragraph",
        Arc::new(First {
            log: log.clone(),
            added: false.into(),
        }),
    )?;
    editor.update(|tx| {
        let a = tx.create(Paragraph {})?;
        let b = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key()])
    })?;
    assert_eq!(*log.lock().expect("log"), vec![1, 1]);
    log.lock().expect("log").clear();
    editor.update(|tx| tx.mark_foreign_type_dirty("paragraph"))?;
    assert_eq!(*log.lock().expect("log"), vec![1, 2, 1, 2]);
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct P2 {}
impl NodeType for P2 {
    const TYPE: &'static str = "p2";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for P2 {
    type Parent = Paragraph;
    fn as_parent_mut(&mut self) -> Option<&mut Paragraph> {
        None
    }
    fn as_parent(&self) -> &Paragraph {
        &Paragraph {}
    }
}

#[test]
fn runtime_transform_registration_and_dirty_marking_include_direct_replacements()
-> Result<(), Error> {
    struct Host;
    impl ForeignTransform for Host {
        fn transform(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
            assert_eq!(tx.type_name(key)?, "p2");
            tx.emit(&ORDER, 1);
            Ok(())
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .replace::<Paragraph, P2>(|_| P2 {})
        .build()
        .expect("editor");
    let id = editor.register_foreign_transform("paragraph", Arc::new(Host))?;
    let (_, first) = editor.update(|tx| {
        let key = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[key.key()])
    })?;
    assert_eq!(
        first.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1]
    );
    let (_, second) = editor.update(|tx| tx.mark_foreign_type_dirty("paragraph"))?;
    assert_eq!(
        second.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1]
    );
    editor.unregister_foreign_transform(id);
    let (_, third) = editor.update(|tx| tx.mark_foreign_type_dirty("paragraph"))?;
    assert_eq!(third.events_of(&ORDER).count(), 0);
    Ok(())
}

#[test]
fn runtime_transforms_skip_composing_and_detached_nodes() -> Result<(), Error> {
    struct Host;
    impl ForeignTransform for Host {
        fn transform(&self, tx: &mut Transaction<'_>, _key: NodeKey) -> Result<(), Error> {
            tx.emit(&ORDER, 1);
            Ok(())
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_transform("text", Arc::new(Host))?;
    let ((attached, detached), commit) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let attached = tx.create_text("a")?.key();
        let detached = tx.create_text("b")?.key();
        tx.append(paragraph, &[attached])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_composition_key(Some(attached))?;
        Ok((attached, detached))
    })?;
    assert_eq!(commit.events_of(&ORDER).count(), 0);
    assert!(editor.state().node(detached).is_none());
    let (_, commit) = editor.update(|tx| {
        tx.set_composition_key(None)?;
        tx.mark_dirty(attached)
    })?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1]
    );
    Ok(())
}

#[test]
fn runtime_listener_callback_identity_deduplicates_both_placement_sides() -> Result<(), Error> {
    struct Host;
    impl ForeignListener for Host {
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            tx.emit(&ORDER, 1);
            Ok(Handled::No)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let callback: Arc<dyn ForeignListener> = Arc::new(Host);
    let first = editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        },
        callback.clone(),
    );
    let second = editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Normal,
            placement: Placement::Before,
        },
        callback.clone(),
    );
    assert_eq!(first, second);
    assert_eq!(first.get(), second.get());
    let low = editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Low,
            placement: Placement::After,
        },
        callback,
    );
    let (_, commit) = editor.dispatch(&Command::Undo)?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 1]
    );
    editor.unregister_foreign_listener(second);
    editor.unregister_foreign_listener(first);
    assert_eq!(
        editor
            .listener_table()
            .levels(CommandKind::Undo)
            .expect("low")
            .bits(),
        2
    );
    editor.unregister_foreign_listener(low);
    assert!(editor.listener_table().levels(CommandKind::Undo).is_none());
    Ok(())
}

#[test]
fn runtime_transform_callback_identity_deduplicates_overlapping_replacement_registrations()
-> Result<(), Error> {
    struct Host;
    impl ForeignTransform for Host {
        fn transform(&self, tx: &mut Transaction<'_>, _key: NodeKey) -> Result<(), Error> {
            tx.emit(&ORDER, 1);
            Ok(())
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .replace::<Paragraph, P2>(|_| P2 {})
        .build()
        .expect("editor");
    let callback: Arc<dyn ForeignTransform> = Arc::new(Host);
    let original = editor.register_foreign_transform("paragraph", callback.clone())?;
    let duplicate = editor.register_foreign_transform("paragraph", callback.clone())?;
    assert_eq!(original, duplicate);
    let replacement = editor.register_foreign_transform("p2", callback.clone())?;
    let (_, commit) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])
    })?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1]
    );
    editor.unregister_foreign_transform(duplicate);
    let (_, commit) = editor.update(|tx| tx.mark_foreign_type_dirty("p2"))?;
    assert_eq!(commit.events_of(&ORDER).count(), 0);
    assert_eq!(
        editor.register_foreign_transform("p2", callback)?,
        replacement
    );
    let (_, commit) = editor.update(|tx| tx.mark_foreign_type_dirty("p2"))?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1]
    );
    editor.unregister_foreign_transform(replacement);
    let (_, commit) = editor.update(|tx| tx.mark_foreign_type_dirty("p2"))?;
    assert_eq!(commit.events_of(&ORDER).count(), 0);
    Ok(())
}

#[test]
fn runtime_command_snapshots_lower_priorities_only_when_reached() -> Result<(), Error> {
    struct Low;
    impl ForeignListener for Low {
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            tx.emit(&ORDER, 2);
            Ok(Handled::No)
        }
    }
    struct High;
    impl ForeignListener for High {
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            tx.emit(&ORDER, 1);
            tx.register_foreign_listener(
                CommandRegistration {
                    command: CommandKind::Undo,
                    priority: CommandPriority::Low,
                    placement: Placement::After,
                },
                Arc::new(Low),
            );
            Ok(Handled::No)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::High,
            placement: Placement::After,
        },
        Arc::new(High),
    );
    let (_, commit) = editor.dispatch(&Command::Undo)?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 2]
    );
    Ok(())
}

#[test]
fn external_command_flush_registers_a_lower_priority_before_its_snapshot() -> Result<(), Error> {
    struct Low;
    impl ForeignListener for Low {
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            tx.emit(&ORDER, 2);
            Ok(Handled::No)
        }
    }
    struct Transform;
    impl ForeignTransform for Transform {
        fn transform(&self, tx: &mut Transaction<'_>, _key: NodeKey) -> Result<(), Error> {
            tx.register_foreign_listener(
                CommandRegistration {
                    command: CommandKind::Undo,
                    priority: CommandPriority::Low,
                    placement: Placement::After,
                },
                Arc::new(Low),
            );
            Ok(())
        }
    }
    struct High;
    impl ForeignListener for High {
        fn handle(&self, tx: &mut Transaction<'_>, _command: &Command) -> Result<Handled, Error> {
            tx.emit(&ORDER, 1);
            let paragraph = tx.create(Paragraph {})?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(Handled::No)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_transform("paragraph", Arc::new(Transform))?;
    editor.register_foreign_listener(
        CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::High,
            placement: Placement::After,
        },
        Arc::new(High),
    );
    let (_, commit) = editor.dispatch(&Command::Undo)?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 2]
    );
    Ok(())
}
