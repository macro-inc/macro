use super::*;
static FIRST: CommandKey<u32> = CommandKey::new("same-name");
static SECOND: CommandKey<u32> = CommandKey::new("same-name");
#[derive(Clone, Default)]
struct Trace(Vec<&'static str>);
struct RecordPlugin {
    name: &'static str,
    commands: [CommandRegistration; 1],
    handled: Handled,
}
impl Plugin for RecordPlugin {
    fn name(&self) -> &'static str {
        self.name
    }
    fn commands(&self) -> &[CommandRegistration] {
        &self.commands
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        tx.extension_mut::<Trace>()?.0.push(self.name);
        Ok(self.handled)
    }
}
#[test]
fn typed_static_keys_use_address_and_payload_arc_identity() {
    assert_eq!(FIRST.name(), "same-name");
    let a = ExtensionCommand::new(&FIRST, 1);
    let b = ExtensionCommand::new(&FIRST, 1);
    assert_eq!(a, a.clone());
    assert_ne!(a, b);
    assert_eq!(a.payload(&FIRST), Some(&1));
    assert_eq!(a.payload(&SECOND), None);
    assert_ne!(
        CommandKind::Extension(&FIRST),
        CommandKind::Extension(&SECOND)
    );
    assert_eq!(Command::Extension(a).kind(), CommandKind::Extension(&FIRST));
}
#[test]
fn listener_order_is_priority_then_reverse_before_then_registration_order() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Trace::default())
        .plugin(RecordPlugin {
            name: "editor",
            commands: [CommandRegistration {
                command: CommandKind::Extension(&FIRST),
                priority: CommandPriority::Editor,
                placement: Placement::After,
            }],
            handled: Handled::No,
        })
        .plugin(RecordPlugin {
            name: "after",
            commands: [CommandRegistration {
                command: CommandKind::Extension(&FIRST),
                priority: CommandPriority::High,
                placement: Placement::After,
            }],
            handled: Handled::No,
        })
        .plugin(RecordPlugin {
            name: "before-a",
            commands: [CommandRegistration {
                command: CommandKind::Extension(&FIRST),
                priority: CommandPriority::High,
                placement: Placement::Before,
            }],
            handled: Handled::No,
        })
        .plugin(RecordPlugin {
            name: "before-b",
            commands: [CommandRegistration {
                command: CommandKind::Extension(&FIRST),
                priority: CommandPriority::High,
                placement: Placement::Before,
            }],
            handled: Handled::No,
        })
        .plugin(RecordPlugin {
            name: "critical",
            commands: [CommandRegistration {
                command: CommandKind::Extension(&FIRST),
                priority: CommandPriority::Critical,
                placement: Placement::After,
            }],
            handled: Handled::No,
        })
        .build()
        .unwrap();
    let (handled, _) = editor.dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 0)))?;
    assert_eq!(handled, Handled::No);
    assert_eq!(
        editor.extension::<Trace>()?.0,
        vec!["critical", "before-b", "before-a", "after", "editor"]
    );
    Ok(())
}
#[test]
fn handled_stops_propagation_and_duplicate_plugins_fail_build() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Trace::default())
        .plugin(RecordPlugin {
            name: "stop",
            commands: [CommandRegistration {
                command: CommandKind::Extension(&FIRST),
                priority: CommandPriority::Critical,
                placement: Placement::After,
            }],
            handled: Handled::Yes,
        })
        .plugin(RecordPlugin {
            name: "editor",
            commands: [CommandRegistration {
                command: CommandKind::Extension(&FIRST),
                priority: CommandPriority::Editor,
                placement: Placement::After,
            }],
            handled: Handled::No,
        })
        .build()
        .unwrap();
    assert_eq!(
        editor
            .dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 0)))?
            .0,
        Handled::Yes
    );
    assert_eq!(editor.extension::<Trace>()?.0, vec!["stop"]);
    let result = Editor::builder(EditorMode::Headless)
        .plugin(RecordPlugin {
            name: "duplicate",
            commands: [CommandRegistration {
                command: CommandKind::SelectionChange,
                priority: CommandPriority::Editor,
                placement: Placement::After,
            }],
            handled: Handled::No,
        })
        .plugin(RecordPlugin {
            name: "duplicate",
            commands: [CommandRegistration {
                command: CommandKind::SelectionChange,
                priority: CommandPriority::High,
                placement: Placement::After,
            }],
            handled: Handled::No,
        })
        .build();
    assert!(matches!(
        result,
        Err(BuildError::DuplicatePlugin { name: "duplicate" })
    ));
    Ok(())
}
static REDISPATCH_COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&FIRST),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];
struct Redispatch;
impl Plugin for Redispatch {
    fn name(&self) -> &'static str {
        "redispatch"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &REDISPATCH_COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let value = command
            .payload(&FIRST)
            .copied()
            .ok_or(Error::Invariant("typed payload"))?;
        if value == 0 {
            tx.extension_mut::<Trace>()?.0.push("outer");
            tx.dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 1)))
        } else {
            tx.extension_mut::<Trace>()?.0.push("inner");
            Ok(Handled::Yes)
        }
    }
}
#[test]
fn reentrant_dispatch_shares_staged_state_and_rollback_discards_it() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Trace::default())
        .plugin(Redispatch)
        .build()
        .unwrap();
    {
        let mut tx = editor.transaction();
        assert_eq!(
            tx.dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 0)))?,
            Handled::Yes
        );
        assert_eq!(tx.extension::<Trace>()?.0, vec!["outer", "inner"]);
    }
    assert!(editor.extension::<Trace>()?.0.is_empty());
    let (handled, _) = editor.dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 0)))?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(editor.extension::<Trace>()?.0, vec!["outer", "inner"]);
    Ok(())
}
#[test]
fn unregistered_commands_return_noop_without_opening_an_update() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (handled, commit) =
        editor.dispatch(&Command::Extension(ExtensionCommand::new(&SECOND, 3)))?;
    assert_eq!(handled, Handled::No);
    assert!(commit.is_noop());
    assert_eq!(commit.prev.node_count(), commit.next.node_count());
    Ok(())
}
struct ContextPlugin;
impl Plugin for ContextPlugin {
    fn name(&self) -> &'static str {
        "context"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::SelectionChange,
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let is_triple = tx
            .selection_change_context()
            .is_some_and(|c| c.triple_click);
        tx.extension_mut::<Trace>()?
            .0
            .push(if is_triple { "triple" } else { "ordinary" });
        Ok(Handled::No)
    }
}
#[test]
fn selection_context_exists_only_during_selection_change_dispatch() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Trace::default())
        .plugin(ContextPlugin)
        .build()
        .unwrap();
    editor.update(|tx| {
        let context = SelectionChangeContext {
            triple_click: true,
            ..SelectionChangeContext::default()
        };
        assert!(tx.selection_change_context().is_none());
        tx.selection_change_format(&context)?;
        assert!(tx.selection_change_context().is_none());
        assert_eq!(tx.extension::<Trace>()?.0, vec!["triple"]);
        Ok(())
    })?;
    Ok(())
}
#[derive(Clone, Default)]
struct Observed(String);
static PRODUCE_COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&FIRST),
    priority: CommandPriority::Critical,
    placement: Placement::After,
}];
static OBSERVE_COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&FIRST),
    priority: CommandPriority::Editor,
    placement: Placement::After,
}];
struct ProduceText;
impl Plugin for ProduceText {
    fn name(&self) -> &'static str {
        "produce"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &PRODUCE_COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let p = tx.create(Paragraph {})?;
        let t = tx.create_text("before")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(Handled::No)
    }
}
struct ObserveText;
impl Plugin for ObserveText {
    fn name(&self) -> &'static str {
        "observe"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &OBSERVE_COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let text = tx.text_content(NodeKey::ROOT).into_owned();
        tx.extension_mut::<Observed>()?.0 = text;
        Ok(Handled::No)
    }
}
fn uppercase_text(tx: &mut Transaction<'_>, text: Id<Text>) -> Result<(), Error> {
    let old = tx.text_content(text).into_owned();
    let new = old.to_uppercase();
    if old != new {
        tx.text(text)?.set_text_content(&new)?;
    }
    Ok(())
}
#[test]
fn outside_dispatch_flushes_between_priorities_and_inline_dispatch_does_not() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Observed::default())
        .plugin(ProduceText)
        .plugin(ObserveText)
        .transform::<Text>(uppercase_text)
        .build()
        .unwrap();
    editor.dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 0)))?;
    assert_eq!(editor.extension::<Observed>()?.0, "BEFORE");
    let mut inline = Editor::builder(EditorMode::Headless)
        .extension_state(Observed::default())
        .plugin(ProduceText)
        .plugin(ObserveText)
        .transform::<Text>(uppercase_text)
        .build()
        .unwrap();
    inline.update(|tx| tx.dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 0))))?;
    assert_eq!(inline.extension::<Observed>()?.0, "before");
    assert_eq!(inline.state().text_content(NodeKey::ROOT), "BEFORE");
    Ok(())
}
struct FailingSelectionChange;
impl Plugin for FailingSelectionChange {
    fn name(&self) -> &'static str {
        "failing-selection-change"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::SelectionChange,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        tx.extension_mut::<Trace>()?.0.push("pending");
        Err(Error::Invariant("listener failure"))
    }
}
#[test]
fn failing_selection_listener_restores_context_and_rolls_back_extension_state() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Trace::default())
        .plugin(FailingSelectionChange)
        .build()
        .unwrap();
    {
        let mut tx = editor.transaction();
        let result = tx.selection_change_format(&SelectionChangeContext::default());
        assert!(matches!(result, Err(Error::Invariant("listener failure"))));
        assert!(tx.selection_change_context().is_none());
    }
    assert!(editor.extension::<Trace>()?.0.is_empty());
    Ok(())
}
struct MutateBoth;
impl Plugin for MutateBoth {
    fn name(&self) -> &'static str {
        "mutate-both"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &PRODUCE_COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        ProduceText.handle(tx, command)?;
        tx.extension_mut::<Trace>()?.0.push("pending");
        Ok(Handled::No)
    }
}
struct FailAfterFlush;
impl Plugin for FailAfterFlush {
    fn name(&self) -> &'static str {
        "fail-after-flush"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &OBSERVE_COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        if tx.text_content(NodeKey::ROOT) != "BEFORE" || tx.extension::<Trace>()?.0 != ["pending"] {
            return Err(Error::Invariant("higher-priority state was not flushed"));
        }
        Err(Error::Invariant("lower-priority failure"))
    }
}
#[test]
fn lower_priority_failure_after_flush_rolls_back_document_and_extension_state() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Trace::default())
        .plugin(MutateBoth)
        .plugin(FailAfterFlush)
        .transform::<Text>(uppercase_text)
        .build()
        .unwrap();
    let before = editor.state().clone();
    let result = editor.dispatch(&Command::Extension(ExtensionCommand::new(&FIRST, 0)));
    assert!(matches!(
        result,
        Err(Error::Invariant("lower-priority failure"))
    ));
    assert_eq!(
        editor.state().children_keys(NodeKey::ROOT)?,
        before.children_keys(NodeKey::ROOT)?
    );
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "");
    assert!(editor.extension::<Trace>()?.0.is_empty());
    Ok(())
}

#[derive(Clone, Default)]
struct ObservedPastes(Vec<ClipboardPayload>);
struct ObservePaste;
impl Plugin for ObservePaste {
    fn name(&self) -> &'static str {
        "observe-paste"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::Paste,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Paste(payload) = command else {
            return Ok(Handled::No);
        };
        tx.extension_mut::<ObservedPastes>()?
            .0
            .push(payload.clone());
        Ok(Handled::No)
    }
}
#[test]
fn paste_dispatch_preserves_captured_intent_and_rich_clipboard_data() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(ObservedPastes::default())
        .plugin(ObservePaste)
        .build()
        .unwrap();
    let ordinary = ClipboardPayload {
        data: [
            ("text/plain".into(), "**literal**".into()),
            ("text/html".into(), "<strong>rich</strong>".into()),
        ]
        .into_iter()
        .collect(),
        has_files: true,
        ..ClipboardPayload::default()
    };
    assert!(!ordinary.intent.plain_only);
    let mut plain = ordinary.clone();
    plain.intent = PasteIntent { plain_only: true };
    assert_eq!(
        editor.dispatch(&Command::Paste(ordinary.clone()))?.0,
        Handled::No
    );
    assert_eq!(
        editor.dispatch(&Command::Paste(plain.clone()))?.0,
        Handled::No
    );
    let observed = &editor.extension::<ObservedPastes>()?.0;
    assert_eq!(observed, &[ordinary, plain]);
    assert!(!observed[0].intent.plain_only);
    assert!(observed[1].intent.plain_only);
    assert_eq!(observed[1].get("text/html"), Some("<strong>rich</strong>"));
    assert!(observed[1].has_files);
    Ok(())
}
