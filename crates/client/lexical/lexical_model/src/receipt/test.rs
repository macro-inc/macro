use super::*;
use crate::*;
use std::sync::atomic::{AtomicUsize, Ordering};

static FACT: ReceiptKey<&'static str> = ReceiptKey::new("same-name");
static OTHER: ReceiptKey<&'static str> = ReceiptKey::new("same-name");
static PUBLIC: EventKey<&'static str> = EventKey::new("same-name");
static ACTION: CommandKey<u8> = CommandKey::new("receipt-test");
#[derive(Debug, PartialEq)]
struct CommitShape {
    dirty_leaves: usize,
    dirty_elements: usize,
    mutations: usize,
    events: usize,
    tags: TagSet,
    selection_changed: bool,
    composition_changed: bool,
    full_reconcile: bool,
    stored_state_superseded: bool,
    preceding: bool,
    following: usize,
    noop: bool,
}
#[derive(Default)]
struct Capture {
    calls: usize,
    ids: Vec<CommitId>,
    values: Vec<&'static str>,
    shapes: Vec<CommitShape>,
}
impl MainCommitReceiptCapture for Capture {
    fn begin(&mut self) {
        *self = Self::default();
    }
    fn capture(&mut self, commit: &Commit, view: MainCommitReceiptView<'_>, _: Handled) {
        self.shapes.push(CommitShape {
            dirty_leaves: commit.changes.dirty_leaves.len(),
            dirty_elements: commit.changes.dirty_elements.len(),
            mutations: commit.changes.mutations.len(),
            events: commit.events.len(),
            tags: commit.tags.clone(),
            selection_changed: commit.selection_changed,
            composition_changed: commit.composition_changed,
            full_reconcile: commit.full_reconcile,
            stored_state_superseded: commit.stored_state_superseded,
            preceding: commit.preceding.is_some(),
            following: commit.following.len(),
            noop: commit.is_noop(),
        });
        self.calls += 1;
        self.ids.push(commit.id);
        self.values.extend(view.values(&FACT).copied());
        assert_eq!(view.values(&OTHER).count(), 0);
    }
}
struct Action {
    after: Arc<AtomicUsize>,
    following: bool,
}
impl Plugin for Action {
    fn name(&self) -> &'static str {
        "receipt-test"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&ACTION),
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(mode) = command.payload(&ACTION) else {
            return Ok(Handled::No);
        };
        if *mode != 0 {
            tx.emit_receipt(&FACT, "main-private-payload");
        }
        if *mode == 2 {
            return Err(Error::Invariant("receipt rollback"));
        }
        if *mode == 4 {
            tx.emit(&PUBLIC, "public-payload");
        }
        if *mode == 3 {
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        }
        Ok(Handled::Yes)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        self.after.fetch_add(1, Ordering::Relaxed);
        if self.following && commit.next.view().children(NodeKey::ROOT).count() == 1 {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("follow-up")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.emit_receipt(&FACT, "following-private-payload");
        }
        Ok(())
    }
}
fn core(following: bool, after: Arc<AtomicUsize>) -> EditorCore {
    let editor = Editor::builder(EditorMode::Headless)
        .plugin(Action { after, following })
        .build()
        .expect("editor");
    EditorCore::new(
        editor,
        CoreConfig {
            history: Some(HistoryConfig::default()),
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    )
}
fn input(mode: u8) -> Input {
    Input::Command {
        command: Command::Extension(ExtensionCommand::new(&ACTION, mode)),
        selection: ViewSelection::KeepModel,
    }
}

#[test]
fn literal_receipts_keep_type_identity_and_are_omitted_from_clone_and_debug() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.emit_receipt(&FACT, "main-private-payload");
    tx.emit_receipt(&FACT, "second-private-payload");
    let commit = tx.commit()?;
    assert!(commit.is_noop());
    assert!(commit.events.is_empty());
    assert_eq!(
        commit
            .receipt_view()
            .values(&FACT)
            .copied()
            .collect::<Vec<_>>(),
        ["main-private-payload", "second-private-payload"]
    );
    assert_eq!(commit.receipt_view().values(&OTHER).count(), 0);
    assert_eq!(commit.clone().receipt_view().values(&FACT).count(), 0);
    let debug = format!("{commit:?}");
    assert!(!debug.contains("private-payload"));
    assert!(!debug.contains("receipts"));
    assert!(!debug.contains("same-name"));
    Ok(())
}

#[test]
fn receipt_only_and_baseline_noop_have_identical_outputs_callbacks_and_history() {
    let baseline_after = Arc::new(AtomicUsize::new(0));
    let receipt_after = Arc::new(AtomicUsize::new(0));
    let mut baseline = core(false, baseline_after.clone());
    let mut receipt = core(false, receipt_after.clone());
    let _ = baseline.take_initial_output();
    let _ = receipt.take_initial_output();
    baseline_after.store(0, Ordering::Relaxed);
    receipt_after.store(0, Ordering::Relaxed);
    let mut baseline_capture = Capture::default();
    let mut receipt_capture = Capture::default();
    let mut baseline_main = MainCommitOutcome::NotPublished;
    let mut receipt_main = MainCommitOutcome::NotPublished;
    let ordinary = baseline
        .apply_with_main_commit_observation(
            input(0),
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut baseline_main, &mut baseline_capture),
        )
        .expect("baseline");
    let captured = receipt
        .apply_with_main_commit_observation(
            input(1),
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut receipt_main, &mut receipt_capture),
        )
        .expect("receipt");
    assert_eq!(ordinary.handled, Handled::Yes);
    assert_eq!(captured.handled, ordinary.handled);
    assert!(ordinary.commits.is_empty());
    assert!(captured.commits.is_empty());
    assert!(ordinary.diff.ops.is_empty());
    assert!(captured.diff.ops.is_empty());
    assert_eq!(captured.effects, ordinary.effects);
    assert_eq!(baseline_after.load(Ordering::Relaxed), 0);
    assert_eq!(receipt_after.load(Ordering::Relaxed), 0);
    assert_eq!(baseline.history().expect("history").undo_depth(), 0);
    assert_eq!(receipt.history().expect("history").undo_depth(), 0);
    assert_eq!(baseline_capture.calls, 1);
    assert_eq!(receipt_capture.calls, 1);
    assert!(baseline_capture.values.is_empty());
    assert_eq!(baseline_capture.shapes, receipt_capture.shapes);
    assert_eq!(
        receipt_capture.shapes,
        [CommitShape {
            dirty_leaves: 0,
            dirty_elements: 0,
            mutations: 0,
            events: 0,
            tags: TagSet::default(),
            selection_changed: false,
            composition_changed: false,
            full_reconcile: false,
            stored_state_superseded: false,
            preceding: false,
            following: 0,
            noop: true
        }]
    );
    assert_eq!(receipt_capture.values, ["main-private-payload"]);
    assert_eq!(
        receipt_main,
        MainCommitOutcome::Published {
            commit_id: receipt_capture.ids[0],
            handled: Handled::Yes
        }
    );
    assert_eq!(
        baseline_main,
        MainCommitOutcome::Published {
            commit_id: baseline_capture.ids[0],
            handled: Handled::Yes
        }
    );
}

#[test]
fn failed_main_discards_receipt_and_does_not_call_capture() {
    let mut core = core(false, Arc::new(AtomicUsize::new(0)));
    let mut capture = Capture::default();
    let mut outcome = MainCommitOutcome::Published {
        commit_id: CommitId(99),
        handled: Handled::Yes,
    };
    assert!(
        core.apply_with_main_commit_observation(
            input(2),
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut outcome, &mut capture)
        )
        .is_err()
    );
    assert_eq!(outcome, MainCommitOutcome::NotPublished);
    assert_eq!(capture.calls, 0);
    assert!(capture.values.is_empty());
    core.apply_with_main_commit_observation(
        input(0),
        HistoryTime(2),
        MainCommitObservation::with_receipts(&mut outcome, &mut capture),
    )
    .expect("healthy next");
    assert_eq!(capture.calls, 1);
    assert!(capture.values.is_empty());
}

#[test]
fn following_same_key_receipt_never_merges_into_main_capture_or_view_output() {
    let mut core = core(true, Arc::new(AtomicUsize::new(0)));
    let mut capture = Capture::default();
    let mut outcome = MainCommitOutcome::NotPublished;
    let output = core
        .apply_with_main_commit_observation(
            input(3),
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut outcome, &mut capture),
        )
        .expect("main and following");
    assert_eq!(capture.calls, 1);
    assert_eq!(capture.values, ["main-private-payload"]);
    assert_eq!(
        outcome,
        MainCommitOutcome::Published {
            commit_id: capture.ids[0],
            handled: Handled::Yes
        }
    );
    assert_eq!(core.state().view().children(NodeKey::ROOT).count(), 2);
    assert!(
        !output
            .effects
            .iter()
            .any(|effect| matches!(effect, Effect::PluginEvent(_)))
    );
    assert!(
        output
            .commits
            .iter()
            .flat_map(Commit::chain)
            .all(|commit| commit.receipt_view().values(&FACT).count() == 0)
    );
}

#[test]
fn suspended_and_prepared_receipts_publish_once_without_changing_noop_shape()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.emit_receipt(&FACT, "main-private-payload");
    let suspended = tx.suspend();
    let mut tx = editor.resume(suspended)?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    let commit = tx.commit()?;
    assert!(commit.is_noop());
    assert_eq!(
        commit
            .receipt_view()
            .values(&FACT)
            .copied()
            .collect::<Vec<_>>(),
        ["main-private-payload"]
    );
    let tx = editor.transaction();
    let next = tx.commit()?;
    assert_eq!(next.receipt_view().values(&FACT).count(), 0);
    Ok(())
}

#[test]
fn dropping_pending_receipts_discards_them() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.emit_receipt(&FACT, "discarded-private-payload");
    drop(tx.suspend());
    let commit = editor.transaction().commit()?;
    assert!(commit.is_noop());
    assert_eq!(commit.receipt_view().values(&FACT).count(), 0);
    Ok(())
}

#[test]
fn same_named_public_event_still_reaches_effects_without_receipt_payload() {
    let after = Arc::new(AtomicUsize::new(0));
    let mut core = core(false, after.clone());
    let _ = core.take_initial_output();
    after.store(0, Ordering::Relaxed);
    let mut capture = Capture::default();
    let mut main = MainCommitOutcome::NotPublished;
    let output = core
        .apply_with_main_commit_observation(
            input(4),
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut main, &mut capture),
        )
        .expect("public event");
    assert_eq!(capture.values, ["main-private-payload"]);
    assert_eq!(after.load(Ordering::Relaxed), 1);
    let events = output
        .effects
        .iter()
        .filter_map(|effect| {
            if let Effect::PluginEvent(event) = effect {
                Some(event)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].payload(&PUBLIC), Some(&"public-payload"));
    assert!(!format!("{output:?}").contains("main-private-payload"));
}

#[test]
fn adding_receipts_after_prepared_adoption_is_refused_without_publication()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    tx.emit_receipt(&FACT, "sealed-private-payload");
    tx.flush()?;
    let prepared = tx.prepare()?;
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    tx.emit_receipt(&FACT, "late-private-payload");
    assert!(tx.commit().is_err());
    let next = editor.transaction().commit()?;
    assert!(next.is_noop());
    assert_eq!(next.receipt_view().values(&FACT).count(), 0);
    Ok(())
}
