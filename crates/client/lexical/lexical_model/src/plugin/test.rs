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

#[derive(Clone)]
struct SavedState(EditorState);
struct EarlyThenFail;
impl Plugin for EarlyThenFail {
    fn name(&self) -> &'static str {
        "early-failure"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        let state = tx.extension::<SavedState>()?.0.clone();
        let text = tx
            .first_descendant(NodeKey::ROOT)
            .ok_or(Error::Invariant("text"))?;
        tx.text(text)?.set_text_content("early write")?;
        tx.set_editor_state(state, TagSet::default())?;
        Err(Error::Invariant("after early publication"))
    }
}
#[test]
fn failed_hook_round_rolls_back_even_after_set_editor_state_early_publication() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("saved")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])
        })
        .unwrap();
    let saved = editor.state().clone();
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(SavedState(saved))
        .plugin(EarlyThenFail)
        .build()
        .unwrap();
    // The saved state uses another registry, so create a same-editor checkpoint.
    let ((text, _), commit) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("main")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])?;
            tx.extension_mut::<SavedState>()?.0 = tx.pending.clone();
            Ok((text.key(), p.key()))
        })
        .unwrap();
    assert_eq!(&*editor.state().root_text_content(), "main");
    assert_eq!(commit.following.len(), 0);
    assert_eq!(
        commit.follow_up_error.as_ref().unwrap().plugin,
        "early-failure"
    );
    assert_eq!(commit.next.view().text_content(text), "main");
    assert_eq!(
        &*editor
            .extension::<SavedState>()
            .unwrap()
            .0
            .root_text_content(),
        "main"
    );
}

struct ConditionalHook {
    result: Result<bool, &'static str>,
    flush: bool,
}
impl Plugin for ConditionalHook {
    fn name(&self) -> &'static str {
        "conditional"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn conditional_after_commit<'a>(&'a self, commit: &'a Commit) -> Option<ConditionalUpdate<'a>> {
        if commit.tags.contains(&UpdateTag::HistoryPush) {
            return None;
        }
        Some(Box::new(move |tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.extension_mut::<Log>()?.0.push("conditional");
            tx.add_tag(UpdateTag::HistoryPush);
            if self.flush {
                tx.flush()?;
            }
            self.result.map_err(Error::Invariant)
        }))
    }
}
#[test]
fn declined_conditional_hooks_discard_flushed_state_extensions_and_tags() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Log::default())
        .plugin(ConditionalHook {
            result: Ok(false),
            flush: true,
        })
        .build()
        .unwrap();
    let allocated = editor.keys.last_allocated();
    let (_, commit) = editor.update(|tx| tx.mark_dirty(NodeKey::ROOT)).unwrap();
    assert!(editor.keys.last_allocated() > allocated);
    assert_eq!(editor.state().view().children_size(NodeKey::ROOT), 0);
    assert!(editor.extension::<Log>().unwrap().0.is_empty());
    assert!(editor.carried_tags.iter().next().is_none());
    assert!(commit.following.is_empty());
    assert!(commit.follow_up_error.is_none());
}
#[test]
fn accepted_conditional_hooks_publish_once_through_the_normal_commit_chain() {
    for flush in [false, true] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .extension_state(Log::default())
            .plugin(ConditionalHook {
                result: Ok(true),
                flush,
            })
            .build()
            .unwrap();
        let (_, commit) = editor.update(|tx| tx.mark_dirty(NodeKey::ROOT)).unwrap();
        assert_eq!(editor.state().view().children_size(NodeKey::ROOT), 1);
        assert_eq!(editor.extension::<Log>().unwrap().0, vec!["conditional"]);
        assert_eq!(commit.following.len(), 1);
        assert!(
            commit.following[0]
                .chain()
                .any(|entry| entry.tags.contains(&UpdateTag::HistoryPush))
        );
        assert!(commit.follow_up_error.is_none());
    }
}

#[test]
fn failed_conditional_hooks_restore_the_round_after_an_early_flush() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Log::default())
        .plugin(ConditionalHook {
            result: Err("declined with error"),
            flush: true,
        })
        .build()
        .unwrap();
    let (_, commit) = editor.update(|tx| tx.mark_dirty(NodeKey::ROOT)).unwrap();
    assert_eq!(editor.state().view().children_size(NodeKey::ROOT), 0);
    assert!(editor.extension::<Log>().unwrap().0.is_empty());
    assert!(commit.following.is_empty());
    assert_eq!(
        commit.follow_up_error.as_ref().unwrap().plugin,
        "conditional"
    );
}

struct ConditionalEndless;
impl Plugin for ConditionalEndless {
    fn name(&self) -> &'static str {
        "conditional-endless"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn conditional_after_commit<'a>(&'a self, _: &'a Commit) -> Option<ConditionalUpdate<'a>> {
        Some(Box::new(|tx| {
            tx.mark_dirty(NodeKey::ROOT)?;
            Ok(true)
        }))
    }
}
#[test]
fn conditional_hooks_obey_the_same_ninety_nine_round_guard() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(ConditionalEndless)
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
fn failed_conditional_hooks_also_roll_back_the_shared_phase_of_the_round() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Log::default())
        .extension_state(Ids::default())
        .plugin(Stamp)
        .plugin(ConditionalHook {
            result: Err("failure after shared hook"),
            flush: false,
        })
        .build()
        .unwrap();
    let (key, commit) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("retained main edit")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])?;
            Ok(text.key())
        })
        .unwrap();
    assert_eq!(
        editor.state().view().text_content(key),
        "retained main edit"
    );
    assert_eq!(&*editor.state().view().text_data(key).unwrap().style, "");
    assert!(editor.extension::<Ids>().unwrap().0.is_empty());
    assert!(editor.extension::<Log>().unwrap().0.is_empty());
    assert!(commit.following.is_empty());
    assert_eq!(commit.follow_up_error.unwrap().plugin, "conditional");
}

struct IsolatedProbe {
    accept: bool,
    fail: bool,
    publish: bool,
}
static PROBED: EventKey<()> = EventKey::new("isolated-probed");
impl Plugin for IsolatedProbe {
    fn name(&self) -> &'static str {
        "isolated-probe"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn isolated_after_commit(&self) -> Option<&dyn IsolatedAfterCommit> {
        Some(self)
    }
}
impl IsolatedAfterCommit for IsolatedProbe {
    fn apply(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<bool, Error> {
        let Some(key) = tx
            .first_descendant(NodeKey::ROOT)
            .filter(|key| tx.is_text(*key))
        else {
            return Ok(false);
        };
        if tx.text_content(key) != "input" || commit.changes.dirty_leaves.is_empty() {
            return Ok(false);
        }
        tx.text(key)?.set_text_content("accepted")?;
        tx.extension_mut::<Log>()?.0.push("isolated");
        tx.emit(&PROBED, ());
        if self.publish {
            tx.set_editor_state(tx.pending.clone(), TagSet::default())?;
        }
        if self.fail {
            return Err(Error::Invariant("isolated failure"));
        }
        Ok(self.accept)
    }
}
#[test]
fn declined_and_failed_isolated_hooks_preserve_shared_commits_even_after_early_publication()
-> Result<(), Error> {
    for fail in [false, true] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .extension_state(Ids::default())
            .extension_state(Log::default())
            .plugin(Stamp)
            .plugin(IsolatedProbe {
                accept: false,
                fail,
                publish: true,
            })
            .build()
            .expect("editor");
        let (key, commit) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("input")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            Ok(text.key())
        })?;
        assert_eq!(editor.state().text_content(NodeKey::ROOT), "input");
        assert_eq!(
            &*editor.state().view().text_data(key)?.style,
            "id: assigned"
        );
        assert!(editor.extension::<Log>()?.0.is_empty());
        assert_eq!(commit.chain().count(), 2);
        assert!(!commit.chain().any(|entry| {
            entry
                .events
                .iter()
                .any(|event| event.name() == "isolated-probed")
        }));
        assert_eq!(
            commit.follow_up_error.as_ref().map(|error| error.plugin),
            fail.then_some("isolated-probe")
        );
    }
    Ok(())
}
#[test]
fn accepted_isolated_hook_publishes_once_and_reenters_the_shared_fixpoint() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Ids::default())
        .extension_state(Log::default())
        .plugin(Stamp)
        .plugin(IsolatedProbe {
            accept: true,
            fail: false,
            publish: false,
        })
        .build()
        .expect("editor");
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("input")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "accepted");
    assert_eq!(editor.extension::<Log>()?.0, vec!["isolated"]);
    assert_eq!(commit.chain().count(), 3);
    assert_eq!(
        commit
            .chain()
            .flat_map(|entry| entry.events_of(&PROBED))
            .count(),
        1
    );
    assert!(commit.follow_up_error.is_none());
    Ok(())
}

struct QueuedIsolatedLoop;
impl Plugin for QueuedIsolatedLoop {
    fn name(&self) -> &'static str {
        "queued-isolated-loop"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn isolated_after_commit(&self) -> Option<&dyn IsolatedAfterCommit> {
        Some(self)
    }
}
impl IsolatedAfterCommit for QueuedIsolatedLoop {
    fn apply(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<bool, Error> {
        if tx.first_child(NodeKey::ROOT).is_none() {
            return Ok(false);
        }
        tx.queue_update(
            |tx| {
                let key = tx
                    .first_descendant(NodeKey::ROOT)
                    .ok_or(Error::Invariant("text"))?;
                let next = format!("{}!", tx.text_content(key));
                tx.text(key)?.set_text_content(&next)?;
                Ok(())
            },
            UpdateOptions::default(),
        )?;
        Ok(true)
    }
}
#[test]
fn isolated_round_limit_includes_mutations_queued_until_commit() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(QueuedIsolatedLoop)
        .build()
        .expect("editor");
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("x")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    assert_eq!(commit.following.len(), 99);
    assert_eq!(editor.state().root_text_content().len(), 100);
    assert!(matches!(
        commit.follow_up_error.as_ref().map(|error| &*error.error),
        Some(Error::EndlessFollowUps)
    ));
    Ok(())
}

#[test]
fn isolated_failure_preserves_shared_and_conditional_publications() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Ids::default())
        .extension_state(Log::default())
        .plugin(Stamp)
        .plugin(ConditionalHook {
            result: Ok(true),
            flush: true,
        })
        .plugin(IsolatedProbe {
            accept: false,
            fail: true,
            publish: true,
        })
        .build()
        .expect("editor");
    let (key, commit) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("input")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(text.key())
    })?;
    assert_eq!(editor.state().view().children_size(NodeKey::ROOT), 2);
    assert_eq!(editor.state().view().text_content(key), "input");
    assert_eq!(
        &*editor.state().view().text_data(key)?.style,
        "id: assigned"
    );
    assert_eq!(editor.extension::<Log>()?.0, vec!["conditional"]);
    assert_eq!(commit.following.len(), 2);
    assert_eq!(
        commit.follow_up_error.as_ref().map(|error| error.plugin),
        Some("isolated-probe")
    );
    assert!(!commit.chain().any(|entry| {
        entry
            .events
            .iter()
            .any(|event| event.name() == "isolated-probed")
    }));
    Ok(())
}
