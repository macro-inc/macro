use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

struct Listener {
    all: Arc<AtomicBool>,
    calls: Arc<AtomicUsize>,
}
impl CommandListener for Listener {
    fn key_down_keys(&self) -> KeyDownKeys {
        if self.all.load(Ordering::SeqCst) {
            KeyDownKeys::All
        } else {
            KeyDownKeys::Only(&["ArrowUp", "ArrowDown"])
        }
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Handled::No)
    }
}
const LOW: CommandRegistration = CommandRegistration {
    command: CommandKind::KeyDown,
    priority: CommandPriority::Low,
    placement: Placement::After,
};
fn key(key: &str) -> Command {
    Command::KeyDown(KeyEvent {
        key: key.into(),
        ..Default::default()
    })
}

#[test]
fn slot_snapshot_dedup_all_dominance_and_real_membership_generations() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let all = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(AtomicUsize::new(0));
    let callback: Arc<dyn CommandListener> = Arc::new(Listener {
        all: all.clone(),
        calls: calls.clone(),
    });
    let initial = editor.listener_table().generation().unwrap();
    let id = editor.register_command_listener(LOW, callback.clone());
    let registered = editor.listener_table().generation().unwrap();
    assert!(registered > initial);
    editor.dispatch(&key("x")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    editor.dispatch(&key("ArrowUp")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    all.store(true, Ordering::SeqCst);
    assert_eq!(editor.register_command_listener(LOW, callback.clone()), id);
    assert_eq!(editor.listener_table().generation(), Some(registered));
    editor.dispatch(&key("x")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let other_calls = Arc::new(AtomicUsize::new(0));
    let other = editor.register_command_listener(
        LOW,
        Arc::new(Listener {
            all: Arc::new(AtomicBool::new(true)),
            calls: other_calls.clone(),
        }),
    );
    assert!(editor.listener_table().key_down_only().next().is_none());
    editor.dispatch(&key("x")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(other_calls.load(Ordering::SeqCst), 1);
    editor.unregister_command_listener(&other);
    let removed = editor.listener_table().generation().unwrap();
    assert!(removed > registered);
    assert_eq!(
        editor.listener_table().key_down_only().collect::<Vec<_>>(),
        vec![(CommandPriority::Low, &["ArrowUp", "ArrowDown"][..])]
    );
    editor.unregister_command_listener(&other);
    assert_eq!(editor.listener_table().generation(), Some(removed));
    editor.unregister_command_listener(&id);
    editor.register_command_listener(LOW, callback);
    editor.dispatch(&key("x")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[test]
fn exhausted_counter_and_table_disable_only_without_panicking_or_reusing_stamps() {
    let counter = std::sync::atomic::AtomicU64::new(u64::MAX - 1);
    assert_eq!(
        allocate_listener_generation(&counter).map(std::num::NonZeroU64::get),
        Some(u64::MAX - 1)
    );
    assert!(allocate_listener_generation(&counter).is_none());
    assert!(allocate_listener_generation(&counter).is_none());
    assert_eq!(counter.load(Ordering::Relaxed), u64::MAX);
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.listener_table.generation = None;
    let id = editor.register_command_listener(
        LOW,
        Arc::new(Listener {
            all: Arc::new(AtomicBool::new(false)),
            calls: Arc::new(AtomicUsize::new(0)),
        }),
    );
    assert!(editor.listener_table().generation().is_none());
    editor.unregister_command_listener(&id);
    assert!(editor.listener_table().generation().is_none());
}

#[test]
#[cfg(not(feature = "foreign-nodes"))]
fn excluded_lower_priority_does_not_force_a_publication_flush() {
    struct Insert;
    impl CommandListener for Insert {
        fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("typed")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            Ok(Handled::No)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.register_command_listener(
        CommandRegistration {
            priority: CommandPriority::High,
            ..LOW
        },
        Arc::new(Insert),
    );
    let calls = Arc::new(AtomicUsize::new(0));
    editor.register_command_listener(
        LOW,
        Arc::new(Listener {
            all: Arc::new(AtomicBool::new(false)),
            calls: calls.clone(),
        }),
    );
    let (_, commit) = editor.dispatch(&key("x")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(commit.preceding.is_none());
    assert_eq!(editor.state().root_text_content().as_ref(), "typed");
}

#[test]
fn only_union_keeps_names_in_real_registration_order() {
    struct Keys(&'static [&'static str]);
    impl CommandListener for Keys {
        fn key_down_keys(&self) -> KeyDownKeys {
            KeyDownKeys::Only(self.0)
        }
        fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            Ok(Handled::No)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.register_command_listener(LOW, Arc::new(Keys(&["ArrowUp"])));
    editor.register_command_listener(LOW, Arc::new(Keys(&["ArrowDown", "ArrowUp"])));
    assert_eq!(
        editor.listener_table().key_down_only().collect::<Vec<_>>(),
        vec![(CommandPriority::Low, &["ArrowUp", "ArrowDown"][..])]
    );
}

#[test]
fn reentrant_same_bucket_snapshot_and_later_filtered_bucket_stay_distinct() {
    struct Expand {
        added: AtomicBool,
        same: Arc<dyn CommandListener>,
        lower: Arc<dyn CommandListener>,
    }
    impl CommandListener for Expand {
        fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            if !self.added.swap(true, Ordering::SeqCst) {
                tx.register_command_listener(
                    CommandRegistration {
                        priority: CommandPriority::High,
                        ..LOW
                    },
                    self.same.clone(),
                );
                tx.register_command_listener(LOW, self.lower.clone());
            }
            Ok(Handled::No)
        }
    }
    let same = Arc::new(AtomicUsize::new(0));
    let lower = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.register_command_listener(
        CommandRegistration {
            priority: CommandPriority::High,
            ..LOW
        },
        Arc::new(Expand {
            added: AtomicBool::new(false),
            same: Arc::new(Listener {
                all: Arc::new(AtomicBool::new(true)),
                calls: same.clone(),
            }),
            lower: Arc::new(Listener {
                all: Arc::new(AtomicBool::new(false)),
                calls: lower.clone(),
            }),
        }),
    );
    editor.dispatch(&key("ArrowDown")).unwrap();
    assert_eq!(same.load(Ordering::SeqCst), 0);
    assert_eq!(lower.load(Ordering::SeqCst), 1);
    editor.dispatch(&key("x")).unwrap();
    assert_eq!(same.load(Ordering::SeqCst), 1);
    assert_eq!(lower.load(Ordering::SeqCst), 1);
}

#[test]
fn non_keydown_slots_never_query_a_key_declaration() {
    struct Ordinary;
    impl CommandListener for Ordinary {
        fn key_down_keys(&self) -> KeyDownKeys {
            panic!("non-KeyDown declaration queried")
        }
        fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            Ok(Handled::Yes)
        }
    }
    struct Static;
    impl Plugin for Static {
        fn name(&self) -> &'static str {
            "non-keydown-declaration"
        }
        fn commands(&self) -> &[CommandRegistration] {
            &[CommandRegistration {
                command: CommandKind::Key(KeyCommand::Enter),
                ..LOW
            }]
        }
        fn key_down_keys(&self) -> KeyDownKeys {
            panic!("static non-KeyDown declaration queried")
        }
        fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            Ok(Handled::No)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(Static)
        .build()
        .unwrap();
    editor.register_command_listener(
        CommandRegistration {
            command: CommandKind::Key(KeyCommand::Enter),
            ..LOW
        },
        Arc::new(Ordinary),
    );
    assert_eq!(
        editor
            .dispatch(&Command::Key {
                command: KeyCommand::Enter,
                event: None
            })
            .unwrap()
            .0,
        Handled::Yes
    );
}

#[test]
#[cfg(feature = "foreign-nodes")]
fn excluded_foreign_profile_level_leaves_pending_tree_unpublished_for_next_listener() {
    struct Observe;
    impl CommandListener for Observe {
        fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            assert_eq!(tx.editor.state().root_text_content().as_ref(), "");
            assert_eq!(tx.view().text_content(NodeKey::ROOT).as_ref(), "pending");
            Ok(Handled::Yes)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.register_command_listener(
        CommandRegistration {
            priority: CommandPriority::Critical,
            ..LOW
        },
        Arc::new(Listener {
            all: Arc::new(AtomicBool::new(false)),
            calls: Arc::new(AtomicUsize::new(0)),
        }),
    );
    editor.register_command_listener(
        CommandRegistration {
            priority: CommandPriority::High,
            ..LOW
        },
        Arc::new(Observe),
    );
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default()).unwrap();
    let text = tx.create_text("pending").unwrap();
    tx.append(NodeKey::ROOT, &[paragraph.key()]).unwrap();
    tx.append(paragraph, &[text.key()]).unwrap();
    assert_eq!(tx.dispatch_inner(&key("x"), true).unwrap(), Handled::Yes);
    tx.commit().unwrap();
    assert_eq!(editor.state().root_text_content().as_ref(), "pending");
}

#[test]
#[cfg(feature = "foreign-nodes")]
fn real_foreign_listener_is_all_and_only_real_registration_changes_generation() {
    struct Foreign(Arc<AtomicUsize>);
    impl crate::foreign::ForeignListener for Foreign {
        fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(Handled::Yes)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.register_command_listener(
        LOW,
        Arc::new(Listener {
            all: Arc::new(AtomicBool::new(false)),
            calls: Arc::new(AtomicUsize::new(0)),
        }),
    );
    let before = editor.listener_table().generation().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let foreign: Arc<dyn crate::foreign::ForeignListener> = Arc::new(Foreign(calls.clone()));
    let id = editor.register_foreign_listener(LOW, foreign.clone());
    let registered = editor.listener_table().generation().unwrap();
    assert!(registered > before);
    assert_eq!(editor.register_foreign_listener(LOW, foreign), id);
    assert_eq!(editor.listener_table().generation(), Some(registered));
    assert!(editor.listener_table().key_down_only().next().is_none());
    editor.dispatch(&key("x")).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    editor.unregister_foreign_listener(id);
    let removed = editor.listener_table().generation().unwrap();
    assert!(removed > registered);
    editor.unregister_foreign_listener(id);
    assert_eq!(editor.listener_table().generation(), Some(removed));
    assert_eq!(
        editor.listener_table().key_down_only().collect::<Vec<_>>(),
        vec![(CommandPriority::Low, &["ArrowUp", "ArrowDown"][..])]
    );
}
