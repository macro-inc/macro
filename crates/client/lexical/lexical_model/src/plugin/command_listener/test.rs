use super::*;
use std::sync::Mutex;
const NORMAL: CommandRegistration = CommandRegistration {
    command: CommandKind::Key(KeyCommand::Enter),
    priority: CommandPriority::Normal,
    placement: Placement::After,
};
const ENTER: Command = Command::Key {
    command: KeyCommand::Enter,
    event: None,
};
static ORDER: EventKey<u8> = EventKey::new("ordinary-command-order");
struct Callback<F>(F);
impl<F> CommandListener for Callback<F>
where
    F: Fn(&mut Transaction<'_>) -> Result<Handled, Error> + Send + Sync + 'static,
{
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        (self.0)(tx)
    }
}
fn callback<F>(f: F) -> Arc<dyn CommandListener>
where
    F: Fn(&mut Transaction<'_>) -> Result<Handled, Error> + Send + Sync + 'static,
{
    Arc::new(Callback(f))
}
#[test]
fn ordinary_same_bucket_mutation_is_visible_without_publication_and_true_stops() -> Result<(), Error>
{
    struct Native(Arc<std::sync::OnceLock<NodeKey>>);
    impl Plugin for Native {
        fn name(&self) -> &'static str {
            "ordinary-native-prefix"
        }
        fn commands(&self) -> &[CommandRegistration] {
            &[NORMAL]
        }
        fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            let key = *self.0.get().expect("text initialized");
            tx.text(key)?.set_text_content("# ")?;
            tx.select_end(key)?;
            tx.emit(&ORDER, 1);
            Ok(Handled::No)
        }
    }
    let key_slot = Arc::new(std::sync::OnceLock::new());
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(Native(key_slot.clone()))
        .build()
        .expect("editor");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("6.")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[t.key()])?;
        tx.select_start(t)?;
        Ok(t.key())
    })?;
    key_slot.set(key).expect("new slot");
    let committed = editor.state().clone();
    editor.register_command_listener(
        NORMAL,
        callback(move |tx| {
            assert_eq!(committed.root_text_content().as_ref(), "6.");
            assert_eq!(tx.view().text_content(key).as_ref(), "# ");
            assert_eq!(
                tx.selection()
                    .and_then(Selection::as_range)
                    .expect("range")
                    .anchor
                    .offset(),
                2
            );
            tx.emit(&ORDER, 2);
            Ok(Handled::Yes)
        }),
    );
    editor.register_command_listener(
        NORMAL,
        callback(|tx| {
            tx.emit(&ORDER, 3);
            Ok(Handled::No)
        }),
    );
    let (handled, commit) = editor.dispatch(&ENTER)?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "# ");
    Ok(())
}
#[test]
fn ordinary_runtime_changes_snapshot_current_bucket_but_visit_later_bucket_live()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let removed = Arc::new(Mutex::new(None::<CommandListenerId>));
    let new_normal = callback(|tx| {
        tx.emit(&ORDER, 4);
        Ok(Handled::No)
    });
    let new_low = callback(|tx| {
        tx.emit(&ORDER, 5);
        Ok(Handled::No)
    });
    let removed_from_callback = removed.clone();
    let first = editor.register_command_listener(
        NORMAL,
        callback(move |tx| {
            tx.emit(&ORDER, 1);
            let id = removed_from_callback
                .lock()
                .expect("id")
                .clone()
                .expect("registered");
            tx.unregister_command_listener(&id);
            tx.register_command_listener(NORMAL, new_normal.clone());
            tx.register_command_listener(
                CommandRegistration {
                    priority: CommandPriority::Low,
                    ..NORMAL
                },
                new_low.clone(),
            );
            Ok(Handled::No)
        }),
    );
    let second = editor.register_command_listener(
        NORMAL,
        callback(|tx| {
            tx.emit(&ORDER, 2);
            Ok(Handled::No)
        }),
    );
    *removed.lock().expect("id") = Some(second.clone());
    editor.register_command_listener(
        CommandRegistration {
            priority: CommandPriority::Low,
            ..NORMAL
        },
        callback(|tx| {
            tx.emit(&ORDER, 3);
            Ok(Handled::No)
        }),
    );
    let (_, commit) = editor.dispatch(&ENTER)?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 2, 3, 5]
    );
    let (_, commit) = editor.dispatch(&ENTER)?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 4, 3, 5]
    );
    editor.unregister_command_listener(&first);
    editor.unregister_command_listener(&first);
    editor.unregister_command_listener(&second);
    let (_, commit) = editor.dispatch(&ENTER)?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![4, 3, 5]
    );
    Ok(())
}
#[test]
fn ordinary_priorities_and_registration_identity_are_independent_of_foreign_feature()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    for (priority, value) in [
        (CommandPriority::Editor, 0),
        (CommandPriority::Low, 1),
        (CommandPriority::Normal, 2),
        (CommandPriority::High, 3),
        (CommandPriority::Critical, 4),
    ] {
        let host = callback(move |tx| {
            tx.emit(&ORDER, value);
            Ok(Handled::No)
        });
        let id = editor
            .register_command_listener(CommandRegistration { priority, ..NORMAL }, host.clone());
        let repeated =
            editor.register_command_listener(CommandRegistration { priority, ..NORMAL }, host);
        assert_eq!(id, repeated);
    }
    let (_, commit) = editor.dispatch(&ENTER)?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![4, 3, 2, 1, 0]
    );
    Ok(())
}
#[test]
fn ordinary_error_keeps_exact_typed_cause_and_stops_later_listener() {
    #[derive(Debug)]
    struct Cause(Arc<()>);
    impl std::fmt::Display for Cause {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("ordinary callback failure")
        }
    }
    impl std::error::Error for Cause {}
    let marker = Arc::new(());
    let expected = marker.clone();
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let before = editor.state().clone();
    editor.register_command_listener(
        NORMAL,
        callback(move |tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            Err(Error::Extension(Box::new(Cause(marker.clone()))))
        }),
    );
    editor.register_command_listener(
        NORMAL,
        callback(|_| panic!("later listener ran after error")),
    );
    let error = editor.dispatch(&ENTER).expect_err("callback failure");
    let Error::Extension(cause) = error else {
        panic!("typed extension lost")
    };
    assert!(Arc::ptr_eq(
        &cause.downcast_ref::<Cause>().expect("original type").0,
        &expected
    ));
    assert_eq!(before.to_json().unwrap(), editor.state().to_json().unwrap());
}

#[cfg(not(feature = "foreign-nodes"))]
fn trace_flush(tx: &mut Transaction<'_>, _: Id<Text>) -> Result<(), Error> {
    tx.emit(&ORDER, 9);
    Ok(())
}
#[cfg(not(feature = "foreign-nodes"))]
#[test]
fn ordinary_native_dispatch_does_not_flush_staged_work_before_first_bucket() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(trace_flush)
        .build()
        .expect("editor");
    editor.register_command_listener(
        NORMAL,
        callback(|tx| {
            tx.emit(&ORDER, 1);
            Ok(Handled::No)
        }),
    );
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("pending")?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.append(p, &[t.key()])?;
    tx.dispatch_inner(&ENTER, true)?;
    tx.emit(&ORDER, 2);
    let commit = tx.commit()?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 2, 9]
    );
    Ok(())
}
#[cfg(not(feature = "foreign-nodes"))]
#[test]
fn ordinary_native_dispatch_leaves_last_bucket_flush_to_outer_commit() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(trace_flush)
        .build()
        .expect("editor");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("initial")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[t.key()])?;
        Ok(t.key())
    })?;
    editor.register_command_listener(
        NORMAL,
        callback(move |tx| {
            tx.emit(&ORDER, 1);
            tx.text(key)?.set_text_content("changed")?;
            Ok(Handled::No)
        }),
    );
    let mut tx = editor.transaction();
    tx.dispatch_inner(&ENTER, true)?;
    tx.emit(&ORDER, 2);
    let commit = tx.commit()?;
    assert_eq!(
        commit.events_of(&ORDER).copied().collect::<Vec<_>>(),
        vec![1, 2, 9]
    );
    Ok(())
}

mod forwarding;
