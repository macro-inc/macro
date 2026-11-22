use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct Journal(Mutex<Vec<Observation>>);
#[derive(Debug)]
enum Observation {
    Published(Box<Commit>),
    Restored(CommitId, EditorState),
    PhaseTwo,
}
impl ForeignPublicationObserver for Journal {
    fn published(&self, commit: &Commit) {
        self.0
            .lock()
            .expect("journal")
            .push(Observation::Published(Box::new(commit.clone())));
    }
    fn rolled_back(&self, restored: &EditorState, cutoff: CommitId) {
        self.0
            .lock()
            .expect("journal")
            .push(Observation::Restored(cutoff, restored.clone()));
    }
}

#[test]
fn publication_is_observed_before_the_next_body_phase_with_exact_update_origin() -> Result<(), Error>
{
    let journal = Arc::new(Journal::default());
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .build()
        .expect("editor");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("second")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let saved = editor.state().clone();
    journal.0.lock().expect("journal").clear();
    let (origin, commit) = editor.update(|tx| {
        tx.text(key)?.set_text_content("first")?;
        let origin = tx.foreign_update_identity();
        tx.set_editor_state(saved, TagSet::default())?;
        assert_eq!(journal.0.lock().expect("journal").len(), 1);
        // This is a real phase-two read after the early publication, not a write
        // through the sealed state-install transaction.
        assert_eq!(tx.text_content(key), "second");
        journal
            .0
            .lock()
            .expect("journal")
            .push(Observation::PhaseTwo);
        Ok(origin)
    })?;
    let first = commit.preceding.as_ref().expect("early commit");
    assert_ne!(first.id, commit.id);
    let events = journal.0.lock().expect("journal");
    assert_eq!(events.len(), 3);
    assert!(matches!(&events[0], Observation::Published(actual)
        if actual.id == first.id && actual.next.text_content(NodeKey::ROOT) == "first"
            && actual.foreign_update.as_ref() == Some(&origin)));
    assert!(matches!(events[1], Observation::PhaseTwo));
    assert!(matches!(&events[2], Observation::Published(actual)
        if actual.id == commit.id && actual.next.text_content(NodeKey::ROOT) == "second"
            && actual.foreign_update.as_ref() == Some(&origin)));
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "second");
    Ok(())
}

struct SharedFailure;
impl Plugin for SharedFailure {
    fn name(&self) -> &'static str {
        "shared-failure"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("revoked")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_editor_state(tx.pending.clone(), TagSet::default())?;
        Err(Error::Invariant("failed after publication"))
    }
}

#[test]
fn failed_shared_round_revokes_the_real_early_receipt_after_restoring_main_state()
-> Result<(), Error> {
    let journal = Arc::new(Journal::default());
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .plugin(SharedFailure)
        .build()
        .expect("editor");
    let (_, commit) = editor.update(|tx| tx.mark_dirty(NodeKey::ROOT))?;
    let events = journal.0.lock().expect("journal");
    assert_eq!(events.len(), 3);
    assert!(
        matches!(&events[0], Observation::Published(actual) if actual.id == commit.id && actual.next.text_content(NodeKey::ROOT).is_empty())
    );
    assert!(
        matches!(&events[1], Observation::Published(actual) if actual.id > commit.id && actual.next.text_content(NodeKey::ROOT) == "revoked")
    );
    assert!(
        matches!(&events[2], Observation::Restored(cutoff, state) if *cutoff == commit.id && state.text_content(NodeKey::ROOT).is_empty())
    );
    assert!(commit.following.is_empty());
    assert_eq!(
        commit.follow_up_error.as_ref().expect("failure").plugin,
        "shared-failure"
    );
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "");
    Ok(())
}

struct Speculative {
    name: &'static str,
    isolated: bool,
    fail: bool,
}
impl Speculative {
    fn publish(&self, tx: &mut Transaction<'_>) -> Result<bool, Error> {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("declined")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_editor_state(tx.pending.clone(), TagSet::default())?;
        if self.fail {
            return Err(Error::Invariant("speculative failure"));
        }
        Ok(false)
    }
}
impl Plugin for Speculative {
    fn name(&self) -> &'static str {
        self.name
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn conditional_after_commit<'a>(&'a self, _: &'a Commit) -> Option<ConditionalUpdate<'a>> {
        if self.isolated {
            None
        } else {
            Some(Box::new(|tx| self.publish(tx)))
        }
    }
    fn isolated_after_commit(&self) -> Option<&dyn IsolatedAfterCommit> {
        if self.isolated { Some(self) } else { None }
    }
}
impl IsolatedAfterCommit for Speculative {
    fn apply(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<bool, Error> {
        self.publish(tx)
    }
}

#[test]
fn conditional_and_isolated_declines_and_failures_report_the_actual_rollback_cutoff()
-> Result<(), Error> {
    for isolated in [false, true] {
        for fail in [false, true] {
            let journal = Arc::new(Journal::default());
            let mut editor = Editor::builder(EditorMode::Headless)
                .foreign_publication_observer(journal.clone())
                .plugin(Speculative {
                    name: "speculative",
                    isolated,
                    fail,
                })
                .build()
                .expect("editor");
            let (_, commit) = editor.update(|tx| tx.mark_dirty(NodeKey::ROOT))?;
            let events = journal.0.lock().expect("journal");
            let revoked = events.iter().position(|entry| matches!(entry,
                Observation::Published(actual) if actual.id > commit.id && actual.next.text_content(NodeKey::ROOT) == "declined"
            )).expect("actual early speculative receipt");
            assert!(events[revoked + 1..].iter().any(|entry| matches!(entry,
                Observation::Restored(cutoff, state) if *cutoff >= commit.id && state.text_content(NodeKey::ROOT).is_empty()
            )));
            assert_eq!(editor.state().text_content(NodeKey::ROOT), "");
            assert!(commit.following.is_empty());
            assert_eq!(commit.follow_up_error.is_some(), fail);
        }
    }
    Ok(())
}

static EVENT: EventKey<()> = EventKey::new("publication-event");
#[test]
fn real_event_and_composition_publications_notify_but_synthetic_noop_does_not() -> Result<(), Error>
{
    let journal = Arc::new(Journal::default());
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .build()
        .expect("editor");
    assert!(editor.noop_commit().is_noop());
    assert!(journal.0.lock().expect("journal").is_empty());
    let (_, event_commit) = editor.update(|tx| {
        tx.emit(&EVENT, ());
        Ok(())
    })?;
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("composing")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let (_, composition_commit) = editor.update(|tx| tx.set_composition_key(Some(key)))?;
    assert!(event_commit.changes.is_empty());
    assert_eq!(event_commit.events_of(&EVENT).count(), 1);
    assert!(composition_commit.composition_changed);
    let events = journal.0.lock().expect("journal");
    assert_eq!(events.len(), 3);
    assert!(
        matches!(&events[0], Observation::Published(actual) if actual.id == event_commit.id && actual.foreign_update.is_some())
    );
    assert!(
        matches!(&events[2], Observation::Published(actual) if actual.id == composition_commit.id && actual.foreign_update.is_some())
    );
    Ok(())
}

#[test]
fn failed_prepublication_encoding_never_notifies() -> Result<(), Error> {
    let journal = Arc::new(Journal::default());
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.mark_dirty(NodeKey::ROOT)?;
    let failed = tx.commit_foreign::<(), Error>(|_| Err(Error::Invariant("encoding failed")));
    assert!(failed.is_err());
    assert!(journal.0.lock().expect("journal").is_empty());
    assert_eq!(editor.state().view().children_size(NodeKey::ROOT), 0);
    Ok(())
}

struct InitialProbe(Arc<Journal>);
impl Plugin for InitialProbe {
    fn name(&self) -> &'static str {
        "initial-probe"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, _: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        let events = self.0.0.lock().expect("journal");
        let Observation::Published(observed) = events.last().expect("initial notification") else {
            panic!("publication must precede initial hooks");
        };
        assert_eq!(observed.id, commit.id);
        assert!(observed.prev.same_snapshot(&commit.prev));
        assert!(observed.next.same_snapshot(&commit.next));
        assert_eq!(observed.changes.mutations, commit.changes.mutations);
        assert_eq!(
            observed.changes.dirty_elements,
            commit.changes.dirty_elements
        );
        assert_eq!(observed.prev.view().children_size(NodeKey::ROOT), 0);
        assert_eq!(observed.changes.mutations.len(), 3);
        assert!(
            observed
                .changes
                .mutations
                .values()
                .all(|mutation| *mutation == Mutation::Created)
        );
        assert_eq!(
            observed.changes.dirty_elements.get(&NodeKey::ROOT),
            Some(&DirtyIntent::Intentional)
        );
        Ok(())
    }
}

#[test]
fn initial_receipt_is_canonical_before_notification_and_initial_followups() {
    let journal = Arc::new(Journal::default());
    let state = serde_json::from_value(serde_json::json!({"root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "children":[{"type":"paragraph", "version":1, "format":"", "indent":0,
            "direction":null, "children":[{"type":"text", "version":1,
                "text":"initial", "format":0, "style":"", "detail":0, "mode":"normal"}]}]
    }}))
    .expect("initial state");
    let editor = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .plugin(InitialProbe(journal.clone()))
        .initial_state(state)
        .build()
        .expect("editor");
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "initial");
    let events = journal.0.lock().expect("journal");
    assert!(matches!(&events[0], Observation::Published(commit)
        if commit.prev.view().children_size(NodeKey::ROOT) == 0
            && commit.next.text_content(NodeKey::ROOT) == "initial"));
}

#[test]
fn sequential_publication_watermarks_never_resurrect_revoked_or_other_owner_receipts()
-> Result<(), Error> {
    let journal = Arc::new(Journal::default());
    let mut failing = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .plugin(Speculative {
            name: "first-speculative",
            isolated: true,
            fail: false,
        })
        .plugin(Speculative {
            name: "second-speculative",
            isolated: true,
            fail: false,
        })
        .build()
        .expect("editor");
    let mut other = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .build()
        .expect("editor");
    let mut independent = vec![];
    for _ in 0..6 {
        let (_, commit) = other.update(|tx| tx.mark_dirty(NodeKey::ROOT))?;
        independent.push(commit.id);
    }
    let (_, main) = failing.update(|tx| tx.mark_dirty(NodeKey::ROOT))?;
    let events = journal.0.lock().expect("journal");
    let mut accepted: Vec<&Commit> = vec![];
    let mut revoked = vec![];
    for event in events.iter() {
        match event {
            Observation::Published(commit) => accepted.push(commit),
            Observation::Restored(cutoff, state) => {
                let owner = state.view().foreign_instance_owner();
                accepted.retain(|commit| {
                    let same_owner =
                        Arc::ptr_eq(&owner.0, &commit.next.view().foreign_instance_owner().0);
                    if same_owner && commit.id > *cutoff {
                        revoked.push(commit.id);
                        false
                    } else {
                        true
                    }
                });
            }
            Observation::PhaseTwo => panic!("no body phase in this fixture"),
        }
    }
    assert_eq!(
        accepted[..6]
            .iter()
            .map(|commit| commit.id)
            .collect::<Vec<_>>(),
        independent
    );
    assert_eq!(accepted[6].id, main.id);
    // The real no-effect shared follow-up is also published; the two isolated
    // speculative receipts are revoked in sequence, not the unrelated owner.
    assert_eq!(accepted.len(), 8);
    assert_eq!(revoked.len(), 2);
    assert!(revoked[0] > main.id && revoked[1] > revoked[0]);
    let cutoffs = events
        .iter()
        .filter_map(|event| match event {
            Observation::Restored(cutoff, _) => Some(*cutoff),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(cutoffs.len(), 2);
    assert_eq!(cutoffs[1], revoked[0]);
    assert!(independent.last().expect("other owner") > &cutoffs[1]);
    assert_eq!(failing.state().view().children_size(NodeKey::ROOT), 0);
    Ok(())
}

#[test]
fn failed_encoding_keeps_an_already_published_prefix_visible_to_the_observer() -> Result<(), Error>
{
    let journal = Arc::new(Journal::default());
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_publication_observer(journal.clone())
        .build()
        .expect("editor");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("saved")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let saved = editor.state().clone();
    journal.0.lock().expect("journal").clear();
    let mut tx = editor.transaction();
    tx.text(key)?.set_text_content("accepted prefix")?;
    tx.set_editor_state(saved, TagSet::default())?;
    assert!(
        tx.commit_foreign::<(), Error>(|_| Err(Error::Invariant("encode tail")))
            .is_err()
    );
    let events = journal.0.lock().expect("journal");
    assert_eq!(events.len(), 1);
    assert!(matches!(&events[0], Observation::Published(commit)
        if commit.next.text_content(NodeKey::ROOT) == "accepted prefix"));
    assert_eq!(
        editor.state().text_content(NodeKey::ROOT),
        "accepted prefix"
    );
    Ok(())
}
