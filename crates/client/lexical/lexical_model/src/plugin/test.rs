use super::*;
#[derive(Clone, Default, Debug, PartialEq)]
struct Log(Vec<&'static str>);
struct Recorder {
    name: &'static str,
    registrations: Vec<CommandRegistration>,
    handled: Handled,
}
impl Plugin for Recorder {
    fn name(&self) -> &'static str {
        self.name
    }
    fn commands(&self) -> &[CommandRegistration] {
        &self.registrations
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        tx.extension_mut::<Log>()?.0.push(self.name);
        Ok(self.handled)
    }
}
#[test]
fn upstream_command_priority_before_placement_and_stop_propagation() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Log::default())
        .plugin(Recorder {
            name: "normal",
            registrations: vec![CommandRegistration {
                command: CommandKind::InsertText,
                priority: CommandPriority::Normal,
                placement: Placement::After,
            }],
            handled: Handled::Yes,
        })
        .plugin(Recorder {
            name: "first",
            registrations: vec![CommandRegistration {
                command: CommandKind::InsertText,
                priority: CommandPriority::Critical,
                placement: Placement::Before,
            }],
            handled: Handled::No,
        })
        .plugin(Recorder {
            name: "second",
            registrations: vec![CommandRegistration {
                command: CommandKind::InsertText,
                priority: CommandPriority::Critical,
                placement: Placement::Before,
            }],
            handled: Handled::No,
        })
        .plugin(Recorder {
            name: "after",
            registrations: vec![CommandRegistration {
                command: CommandKind::InsertText,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            }],
            handled: Handled::No,
        })
        .plugin(Recorder {
            name: "low",
            registrations: vec![CommandRegistration {
                command: CommandKind::InsertText,
                priority: CommandPriority::Low,
                placement: Placement::After,
            }],
            handled: Handled::Yes,
        })
        .build()
        .unwrap();
    let table = editor.listener_table();
    let levels = table.levels(CommandKind::InsertText).unwrap();
    assert_eq!(levels.bits(), 0b10110);
    assert_eq!(levels.highest(), Some(CommandPriority::Critical));
    assert!(levels.contains(CommandPriority::Low));
    assert_eq!(table.levels(CommandKind::Undo), None);
    assert_eq!(
        table.iter().collect::<Vec<_>>(),
        vec![(CommandKind::InsertText, levels)]
    );
    let (handled, commit) = editor.dispatch(&Command::InsertText("x".into())).unwrap();
    assert_eq!(handled, Handled::Yes);
    assert!(commit.is_noop());
    assert_eq!(
        editor.extension::<Log>().unwrap().0,
        vec!["second", "first", "after", "normal"]
    );
    let (handled, commit) = editor.dispatch(&Command::Undo).unwrap();
    assert_eq!(handled, Handled::No);
    assert!(commit.is_noop());
}

struct CreateAndObserve;
impl Plugin for CreateAndObserve {
    fn name(&self) -> &'static str {
        "create"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[
            CommandRegistration {
                command: CommandKind::InsertParagraph,
                priority: CommandPriority::Critical,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::InsertParagraph,
                priority: CommandPriority::High,
                placement: Placement::After,
            },
        ]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        if tx.children_size(NodeKey::ROOT) == 0 {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("lowercase")?;
            tx.append(p, &[t.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            Ok(Handled::No)
        } else {
            let result = if tx.text_content(NodeKey::ROOT) == "UPPERCASE" {
                "flushed"
            } else {
                "inline"
            };
            tx.extension_mut::<Log>()?.0.push(result);
            tx.prevent_default();
            Ok(Handled::Yes)
        }
    }
}
#[test]
fn external_dispatch_flushes_between_levels_but_transaction_dispatch_does_not() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Log::default())
        .plugin(CreateAndObserve)
        .transform::<Text>(|tx, key| {
            if tx.text_content(key) == "lowercase" {
                tx.text(key)?.set_text_content("UPPERCASE")?;
            }
            Ok(())
        })
        .build()
        .unwrap();
    let (_, commit) = editor.dispatch(&Command::InsertParagraph).unwrap();
    assert!(commit.default_prevented);
    assert_eq!(editor.extension::<Log>().unwrap().0, vec!["flushed"]);
    editor
        .update(|tx| {
            tx.clear(NodeKey::ROOT)?;
            assert_eq!(tx.dispatch(&Command::InsertParagraph)?, Handled::Yes);
            Ok(())
        })
        .unwrap();
    assert_eq!(
        editor.extension::<Log>().unwrap().0,
        vec!["flushed", "inline"]
    );
}

#[derive(Clone, Default)]
struct Ids(Vec<NodeKey>);
struct Stamp;
impl Plugin for Stamp {
    fn name(&self) -> &'static str {
        "stamp"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        for (key, mutation) in &commit.changes.mutations {
            if *mutation == Mutation::Created && tx.is_text(*key) {
                tx.text(*key)?.set_style("id: assigned")?;
                tx.extension_mut::<Ids>()?.0.push(*key);
            }
        }
        Ok(())
    }
}
struct ObserveStamp;
static SEEN: EventKey<NodeKey> = EventKey::new("stamp-seen");
impl Plugin for ObserveStamp {
    fn name(&self) -> &'static str {
        "observe"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        for (key, mutation) in &commit.changes.mutations {
            if *mutation == Mutation::Created && tx.is_text(*key) {
                assert_eq!(&*tx.view().text_data(*key)?.style, "id: assigned");
                tx.emit(&SEEN, *key);
            }
        }
        Ok(())
    }
}
#[test]
fn hooks_share_one_transaction_and_reach_fixpoint_headlessly() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Ids::default())
        .plugin(Stamp)
        .plugin(ObserveStamp)
        .build()
        .unwrap();
    let (key, commit) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("x")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            Ok(t.key())
        })
        .unwrap();
    assert_eq!(commit.chain().count(), 2);
    assert_eq!(commit.following.len(), 1);
    assert_eq!(
        &*commit.following[0]
            .next
            .view()
            .text_data(key)
            .unwrap()
            .style,
        "id: assigned"
    );
    assert_eq!(
        commit.following[0]
            .events_of(&SEEN)
            .copied()
            .collect::<Vec<_>>(),
        vec![key]
    );
    assert_eq!(editor.extension::<Ids>().unwrap().0, vec![key]);
    assert!(commit.follow_up_error.is_none());
}
struct Failing;
impl Plugin for Failing {
    fn name(&self) -> &'static str {
        "failure"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        tx.extension_mut::<Log>()?.0.push("rolled back");
        tx.clear(NodeKey::ROOT)?;
        Err(Error::Invariant("hook failure"))
    }
}
#[test]
fn hook_failure_rolls_back_its_round_and_retains_main_commit() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Log::default())
        .plugin(Failing)
        .build()
        .unwrap();
    let (_, commit) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])
        })
        .unwrap();
    assert_eq!(commit.follow_up_error.as_ref().unwrap().plugin, "failure");
    assert_eq!(
        commit.follow_up_error.as_ref().unwrap().error.kind(),
        "Invariant"
    );
    assert_eq!(editor.state().view().children_size(NodeKey::ROOT), 1);
    assert!(editor.extension::<Log>().unwrap().0.is_empty());
    assert!(commit.following.is_empty());
}
struct Endless;
impl Plugin for Endless {
    fn name(&self) -> &'static str {
        "endless"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        tx.mark_dirty(NodeKey::ROOT)
    }
}
#[test]
fn ninety_nine_follow_up_round_guard() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(Endless)
        .build()
        .unwrap();
    let (_, commit) = editor.update(|tx| tx.mark_dirty(NodeKey::ROOT)).unwrap();
    assert_eq!(commit.following.len(), 99);
    assert_eq!(
        commit.follow_up_error.unwrap().error.kind(),
        "EndlessFollowUps"
    );
}
#[test]
fn initial_state_hooks_are_drained_once() {
    let json=serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"text","version":1,"text":"initial","format":0,"style":"","detail":0,"mode":"normal"}]}]}})).unwrap();
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Ids::default())
        .plugin(Stamp)
        .initial_state(json)
        .build()
        .unwrap();
    let commits = editor.take_initial_commits();
    assert_eq!(commits.len(), 1);
    assert_eq!(&*commits[0].next.root_text_content(), "initial");
    assert!(editor.take_initial_commits().is_empty());
    let text = editor
        .state()
        .view()
        .first_descendant(NodeKey::ROOT)
        .unwrap();
    assert_eq!(
        &*editor.state().view().text_data(text).unwrap().style,
        "id: assigned"
    );
}
